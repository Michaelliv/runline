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
      "document.get",
      "document.batchUpdate",
      "document.insertText",
      "document.replaceAllText",
      "document.deleteContentRange",
      "document.createParagraphBullets",
      "document.deleteParagraphBullets",
      "document.updateTextStyle",
      "document.insertTable",
      "document.insertTableRow",
      "document.deleteTableRow",
      "document.insertTableColumn",
      "document.deleteTableColumn",
      "document.updateTableCellStyle",
      "document.mergeTableCells",
      "document.unmergeTableCells",
      "document.insertPageBreak",
      "document.createNamedRange",
      "document.deleteNamedRange",
      "document.createHeader",
      "document.deleteHeader",
      "document.createFooter",
      "document.deleteFooter",
      "document.deletePositionedObject",
      "document.insertSectionBreak",
      "document.updateDocumentStyle",
      "document.updateParagraphStyle",
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
      },
      ctx(),
    );

    assert.deepEqual(result, { documentId: "doc_123", content: "Hello world" });
    assert.equal(
      calls[0].url,
      "https://docs.googleapis.com/v1/documents/doc_123",
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
      },
      ctx(),
    );

    assert.deepEqual(calls[0].body, {
      requests: [
        {
          insertInlineImage: {
            location: { segmentId: "", index: 2 },
            uri: "https://example.com/a.png",
            objectSize: { width: { magnitude: 100, unit: "PT" } },
          },
        },
      ],
    });
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
});
