import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import googleDocs from "../../../runline-plugins/googleDocs/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeGoogleDocs(): PluginDef {
  const { api, resolve } = createPluginAPI("googleDocs");
  googleDocs(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected googleDocs.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "googleDocs",
      plugin: "googleDocs",
      config: {
        accessToken: "tok_docs",
        accessTokenExpiresAt: Date.now() + 3_600_000,
        ...config,
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

async function captureFetch(
  result: unknown = { documentId: "doc_1", replies: [{}] },
) {
  const calls: Array<{ url: string; init?: RequestInit; body?: unknown }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(result);
  }) as typeof fetch;
  return calls;
}

describe("googleDocs plugin", () => {
  it("registers the full preserved Google Docs action surface", () => {
    const plugin = makeGoogleDocs();
    const names = plugin.actions.map((a) => a.name);
    assert.deepEqual(names, [
      "document.create",
      "document.createBlank",
      "document.get",
      "document.batchUpdate",
      "document.insertText",
      "document.replaceAllText",
      "document.deleteContentRange",
      "document.createParagraphBullets",
      "document.deleteParagraphBullets",
      "document.insertPerson",
      "document.insertRichLink",
      "document.insertDate",
      "document.updateTextStyle",
      "document.insertTable",
      "document.insertTableRow",
      "document.deleteTableRow",
      "document.insertTableColumn",
      "document.deleteTableColumn",
      "document.updateTableCellStyle",
      "document.mergeTableCells",
      "document.unmergeTableCells",
      "document.updateTableColumnProperties",
      "document.updateTableRowStyle",
      "document.pinTableHeaderRows",
      "document.addDocumentTab",
      "document.deleteTab",
      "document.updateDocumentTabProperties",
      "document.insertPageBreak",
      "document.createNamedRange",
      "document.deleteNamedRange",
      "document.createHeader",
      "document.deleteHeader",
      "document.createFooter",
      "document.deleteFooter",
      "document.deletePositionedObject",
      "document.createFootnote",
      "document.replaceNamedRangeContent",
      "document.updateSectionStyle",
      "document.insertSectionBreak",
      "document.updateDocumentStyle",
      "document.updateParagraphStyle",
      "document.updateNamedStyle",
      "document.insertInlineImage",
      "document.replaceImage",
    ]);
  });

  it("preserves OAuth scopes, env-backed connection fields, and representative schemas", () => {
    const plugin = makeGoogleDocs();
    assert.deepEqual(plugin.oauth?.scopes, [
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    const connectionSchema = plugin.connectionConfigSchema as Record<
      string,
      { env?: string }
    >;
    assert.equal(connectionSchema.clientId?.env, "GOOGLE_DOCS_CLIENT_ID");
    assert.equal(
      connectionSchema.serviceAccountSubject?.env,
      "GOOGLE_DOCS_SERVICE_ACCOUNT_SUBJECT",
    );

    const create = getAction(plugin, "document.create");
    assert.equal(create.inputSchema?.title?.required, true);
    assert.equal(create.inputSchema?.folderId?.required, false);

    const updateTextStyle = getAction(plugin, "document.updateTextStyle");
    assert.equal(
      updateTextStyle.inputSchema?.foregroundColorHex?.type,
      "string",
    );
    assert.equal(updateTextStyle.inputSchema?.startIndex?.required, true);
  });

  it("uses Drive files.create for document.create without refreshing cached tokens", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ id: "file_1", name: "Doc" });

    const result = await getAction(plugin, "document.create").execute(
      { title: "Doc", folderId: "folder_1" },
      ctx(),
    );

    assert.deepEqual(result, { id: "file_1", name: "Doc" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://www.googleapis.com/drive/v3/files");
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(
      (calls[0].init?.headers as Record<string, string>).Authorization,
      "Bearer tok_docs",
    );
    assert.deepEqual(calls[0].body, {
      name: "Doc",
      mimeType: "application/vnd.google-apps.document",
      parents: ["folder_1"],
    });
  });

  it("supports native Docs create and tab-aware get", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_new", title: "Doc" });

    const result = await getAction(plugin, "document.createBlank").execute(
      { title: "Doc" },
      ctx(),
    );

    assert.deepEqual(result, { documentId: "doc_new", title: "Doc" });
    assert.deepEqual(calls[0].body, { title: "Doc" });
    assert.equal(calls[0].url, "https://docs.googleapis.com/v1/documents");
  });

  it("gets a document by URL and flattens simple body text", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({
      body: {
        content: [
          { paragraph: { elements: [{ textRun: { content: "Hello " } }] } },
          { paragraph: { elements: [{ textRun: { content: "world" } }] } },
        ],
      },
    });

    const result = await getAction(plugin, "document.get").execute(
      {
        document: "https://docs.google.com/document/d/doc_123/edit",
        simple: true,
        includeTabsContent: true,
      },
      ctx(),
    );

    assert.deepEqual(result, { documentId: "doc_123", content: "Hello world" });
    assert.equal(
      calls[0].url,
      "https://docs.googleapis.com/v1/documents/doc_123?includeTabsContent=true",
    );
  });

  it("sends single-request helpers as a flat batchUpdate request array", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.insertText").execute(
      { document: "doc_1", text: "Hi", locationKind: "location", index: 1 },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          insertText: {
            text: "Hi",
            location: { segmentId: "", index: 1 },
          },
        },
      ],
    });
  });

  it("keeps array-request helpers flat and uses correct inline image Location shape", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.insertInlineImage").execute(
      {
        document: "doc_1",
        index: 2,
        uri: "https://example.com/a.png",
        widthPt: 100,
        tabId: "tab_1",
      },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          insertInlineImage: {
            location: { segmentId: "", index: 2, tabId: "tab_1" },
            uri: "https://example.com/a.png",
            objectSize: { width: { magnitude: 100, unit: "PT" } },
          },
        },
      ],
    });
  });

  it("supports tab-scoped image replacement and positioned object deletion", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.replaceImage").execute(
      {
        document: "doc_1",
        imageObjectId: "img_1",
        uri: "https://example.com/b.png",
        tabId: "tab_1",
      },
      ctx(),
    );
    await getAction(plugin, "document.deletePositionedObject").execute(
      { document: "doc_1", objectId: "obj_1", tabId: "tab_1" },
      ctx(),
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        {
          requests: [
            {
              replaceImage: {
                imageObjectId: "img_1",
                uri: "https://example.com/b.png",
                imageReplaceMethod: "CENTER_CROP",
                tabId: "tab_1",
              },
            },
          ],
        },
        {
          requests: [
            {
              deletePositionedObject: { objectId: "obj_1", tabId: "tab_1" },
            },
          ],
        },
      ],
    );
  });

  it("uses correct section break Location shape", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.insertSectionBreak").execute(
      { document: "doc_1", index: 3, sectionType: "NEXT_PAGE" },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          insertSectionBreak: {
            location: { segmentId: "", index: 3 },
            sectionType: "NEXT_PAGE",
          },
        },
      ],
    });
  });

  it("supports table property and header row requests with tab-aware locations", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.updateTableColumnProperties").execute(
      {
        document: "doc_1",
        tableStartIndex: 10,
        columnIndices: [0, 2],
        widthPt: 72,
        tabId: "tab_1",
      },
      ctx(),
    );
    await getAction(plugin, "document.pinTableHeaderRows").execute(
      {
        document: "doc_1",
        tableStartIndex: 10,
        pinnedHeaderRowsCount: 1,
        tabId: "tab_1",
      },
      ctx(),
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        {
          requests: [
            {
              updateTableColumnProperties: {
                tableStartLocation: {
                  segmentId: "",
                  index: 10,
                  tabId: "tab_1",
                },
                columnIndices: [0, 2],
                tableColumnProperties: {
                  width: { magnitude: 72, unit: "PT" },
                },
                fields: "width",
              },
            },
          ],
        },
        {
          requests: [
            {
              pinTableHeaderRows: {
                tableStartLocation: {
                  segmentId: "",
                  index: 10,
                  tabId: "tab_1",
                },
                pinnedHeaderRowsCount: 1,
              },
            },
          ],
        },
      ],
    );
  });

  it("supports table row style requests", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.updateTableRowStyle").execute(
      {
        document: "doc_1",
        tableStartIndex: 10,
        rowIndices: [1],
        minRowHeightPt: 24,
      },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          updateTableRowStyle: {
            tableStartLocation: { segmentId: "", index: 10 },
            rowIndices: [1],
            tableRowStyle: {
              minRowHeight: { magnitude: 24, unit: "PT" },
            },
            fields: "minRowHeight",
          },
        },
      ],
    });
  });

  it("supports regex/tab-scoped replacement and smart-chip insert requests", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.replaceAllText").execute(
      {
        document: "doc_1",
        findText: "Client (.*)",
        replaceText: "Client Acme",
        searchByRegex: true,
        tabIds: ["tab_1"],
      },
      ctx(),
    );
    await getAction(plugin, "document.insertPerson").execute(
      {
        document: "doc_1",
        index: 5,
        personProperties: { email: "a@example.com" },
        tabId: "tab_1",
      },
      ctx(),
    );
    await getAction(plugin, "document.insertRichLink").execute(
      {
        document: "doc_1",
        index: 6,
        richLinkProperties: { uri: "https://example.com" },
      },
      ctx(),
    );
    await getAction(plugin, "document.insertDate").execute(
      { document: "doc_1", index: 7, dateElementProperties: { text: "Today" } },
      ctx(),
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        {
          requests: [
            {
              replaceAllText: {
                replaceText: "Client Acme",
                containsText: {
                  text: "Client (.*)",
                  matchCase: false,
                  searchByRegex: true,
                },
                tabsCriteria: { tabIds: ["tab_1"] },
              },
            },
          ],
        },
        {
          requests: [
            {
              insertPerson: {
                personProperties: { email: "a@example.com" },
                location: { segmentId: "", index: 5, tabId: "tab_1" },
              },
            },
          ],
        },
        {
          requests: [
            {
              insertRichLink: {
                richLinkProperties: { uri: "https://example.com" },
                location: { segmentId: "", index: 6 },
              },
            },
          ],
        },
        {
          requests: [
            {
              insertDate: {
                dateElementProperties: { text: "Today" },
                location: { segmentId: "", index: 7 },
              },
            },
          ],
        },
      ],
    );
  });

  it("supports document tab lifecycle requests", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.addDocumentTab").execute(
      { document: "doc_1", title: "Notes", index: 1, parentTabId: "root" },
      ctx(),
    );
    await getAction(plugin, "document.updateDocumentTabProperties").execute(
      { document: "doc_1", tabId: "tab_1", title: "Renamed" },
      ctx(),
    );
    await getAction(plugin, "document.deleteTab").execute(
      { document: "doc_1", tabId: "tab_2" },
      ctx(),
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        {
          requests: [
            {
              addDocumentTab: {
                tabProperties: {
                  title: "Notes",
                  index: 1,
                  parentTabId: "root",
                },
              },
            },
          ],
        },
        {
          requests: [
            {
              updateDocumentTabProperties: {
                tabProperties: { tabId: "tab_1", title: "Renamed" },
                fields: "title",
              },
            },
          ],
        },
        {
          requests: [
            {
              deleteTab: { tabId: "tab_2" },
            },
          ],
        },
      ],
    );
  });

  it("supports named style update requests", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.updateNamedStyle").execute(
      {
        document: "doc_1",
        namedStyle: { namedStyleType: "HEADING_1", textStyle: { bold: true } },
        fields: "textStyle.bold",
        tabId: "tab_1",
      },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          updateNamedStyle: {
            namedStyle: {
              namedStyleType: "HEADING_1",
              textStyle: { bold: true },
            },
            fields: "textStyle.bold",
            tabId: "tab_1",
          },
        },
      ],
    });
  });

  it("supports footnote, named range replacement, and section style requests", async () => {
    const plugin = makeGoogleDocs();
    const calls = await captureFetch({ documentId: "doc_1", replies: [{}] });

    await getAction(plugin, "document.createFootnote").execute(
      { document: "doc_1", index: 4, tabId: "tab_1" },
      ctx(),
    );
    await getAction(plugin, "document.replaceNamedRangeContent").execute(
      {
        document: "doc_1",
        namedRangeName: "client_name",
        text: "Acme",
        tabIds: ["tab_1"],
      },
      ctx(),
    );
    await getAction(plugin, "document.updateSectionStyle").execute(
      {
        document: "doc_1",
        startIndex: 1,
        endIndex: 20,
        marginLeftPt: 36,
        tabId: "tab_1",
      },
      ctx(),
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        {
          requests: [
            {
              createFootnote: {
                location: { segmentId: "", index: 4, tabId: "tab_1" },
              },
            },
          ],
        },
        {
          requests: [
            {
              replaceNamedRangeContent: {
                text: "Acme",
                namedRangeName: "client_name",
                tabsCriteria: { tabIds: ["tab_1"] },
              },
            },
          ],
        },
        {
          requests: [
            {
              updateSectionStyle: {
                range: {
                  segmentId: "",
                  startIndex: 1,
                  endIndex: 20,
                  tabId: "tab_1",
                },
                sectionStyle: { marginLeft: { magnitude: 36, unit: "PT" } },
                fields: "marginLeft",
              },
            },
          ],
        },
      ],
    );
  });
});
