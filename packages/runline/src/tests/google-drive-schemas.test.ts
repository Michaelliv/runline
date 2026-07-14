import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface SchemaNode {
  type?: string;
  const?: unknown;
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  items?: SchemaNode;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  minimum?: number;
  minItems?: number;
  pattern?: string;
}

function makeGoogleDrive(): PluginDef {
  const { api, resolve } = createPluginAPI("googleDrive");
  googleDrive(api);
  return resolve();
}

function schemaFor(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((candidate) => candidate.name === name);
  assert.ok(action, `expected googleDrive.${name} to be registered`);
  assert.ok(
    action.inputSchema,
    `expected googleDrive.${name} to have a schema`,
  );
  return action.inputSchema;
}

function valid(schema: unknown, value: unknown): boolean {
  return Check(schema as never, value);
}

function sampleFor(schema: SchemaNode): unknown {
  if (schema.const !== undefined) return schema.const;
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives?.length) return sampleFor(alternatives[0]);
  switch (schema.type) {
    case "string":
      if (schema.pattern?.includes("https://")) return "https://example.com";
      if (schema.pattern?.includes("0-9A-Fa-f")) return "#00aaff";
      if (schema.pattern?.includes("\\d{4}")) return "2026-07-14T12:00:00Z";
      return "x";
    case "number":
    case "integer":
      return Math.max(schema.minimum ?? 0, 1);
    case "boolean":
      return true;
    case "array":
      return schema.minItems ? [sampleFor(schema.items ?? {})] : [];
    case "object": {
      const result: Record<string, unknown> = {};
      for (const key of schema.required ?? []) {
        result[key] = sampleFor(schema.properties?.[key] ?? {});
      }
      return result;
    }
    default:
      return null;
  }
}

const EXPECTED_ACTIONS = [
  "file.upload",
  "file.createFromText",
  "file.download",
  "file.copy",
  "file.move",
  "file.update",
  "file.delete",
  "file.get",
  "file.share",
  "file.listPermissions",
  "file.deletePermission",
  "folder.create",
  "folder.delete",
  "folder.share",
  "fileFolder.search",
  "drive.create",
  "drive.get",
  "drive.list",
  "drive.update",
  "drive.delete",
  "comment.list",
  "comment.get",
  "comment.create",
  "comment.update",
  "comment.delete",
  "comment.resolve",
  "comment.reopen",
  "reply.list",
  "reply.create",
  "reply.update",
  "reply.delete",
  "revision.list",
  "revision.get",
  "revision.download",
  "revision.update",
  "revision.delete",
  "revision.restore",
  "changes.getStartPageToken",
  "changes.list",
  "changes.watch",
  "changes.stop",
  "permission.update",
  "accessProposal.list",
  "accessProposal.resolve",
  "about.get",
  "file.export",
  "file.list",
] as const;

const VALID_INPUTS: Record<
  (typeof EXPECTED_ACTIONS)[number],
  Record<string, unknown>
> = {
  "file.upload": { contentBase64: "aGVsbG8=" },
  "file.createFromText": { content: "hello" },
  "file.download": { fileId: "file" },
  "file.copy": { fileId: "file" },
  "file.move": { fileId: "file" },
  "file.update": { fileId: "file", name: "Renamed" },
  "file.delete": { fileId: "file" },
  "file.get": { fileId: "file" },
  "file.share": { fileId: "file", role: "reader", type: "anyone" },
  "file.listPermissions": { fileId: "file" },
  "file.deletePermission": { fileId: "file", permissionId: "permission" },
  "folder.create": {},
  "folder.delete": { folderId: "folder" },
  "folder.share": { folderId: "folder", role: "reader", type: "anyone" },
  "fileFolder.search": {},
  "drive.create": { name: "Drive" },
  "drive.get": { driveId: "drive" },
  "drive.list": {},
  "drive.update": { driveId: "drive", name: "Renamed" },
  "drive.delete": { driveId: "drive" },
  "comment.list": { fileId: "file" },
  "comment.get": { fileId: "file", commentId: "comment" },
  "comment.create": { fileId: "file", content: "Comment" },
  "comment.update": {
    fileId: "file",
    commentId: "comment",
    content: "Updated",
  },
  "comment.delete": { fileId: "file", commentId: "comment" },
  "comment.resolve": { fileId: "file", commentId: "comment" },
  "comment.reopen": { fileId: "file", commentId: "comment" },
  "reply.list": { fileId: "file", commentId: "comment" },
  "reply.create": { fileId: "file", commentId: "comment", content: "Reply" },
  "reply.update": {
    fileId: "file",
    commentId: "comment",
    replyId: "reply",
    content: "Updated",
  },
  "reply.delete": { fileId: "file", commentId: "comment", replyId: "reply" },
  "revision.list": { fileId: "file" },
  "revision.get": { fileId: "file", revisionId: "revision" },
  "revision.download": { fileId: "file", revisionId: "revision" },
  "revision.update": {
    fileId: "file",
    revisionId: "revision",
    keepForever: true,
  },
  "revision.delete": { fileId: "file", revisionId: "revision" },
  "revision.restore": { fileId: "file", revisionId: "revision" },
  "changes.getStartPageToken": {},
  "changes.list": { pageToken: "token" },
  "changes.watch": { pageToken: "token", address: "https://example.com/hook" },
  "changes.stop": { channelId: "channel", resourceId: "resource" },
  "permission.update": {
    fileId: "file",
    permissionId: "permission",
    role: "writer",
  },
  "accessProposal.list": { fileId: "file" },
  "accessProposal.resolve": {
    fileId: "file",
    proposalId: "proposal",
    action: "DENY",
  },
  "about.get": {},
  "file.export": { fileId: "file", mimeType: "application/pdf" },
  "file.list": {},
};

describe("googleDrive TypeBox action schemas", () => {
  it("registers the complete 47-action surface in stable order", () => {
    assert.deepEqual(
      makeGoogleDrive().actions.map((action) => action.name),
      EXPECTED_ACTIONS,
    );
  });

  it("uses strict top-level TypeBox objects for every action", () => {
    const plugin = makeGoogleDrive();
    for (const name of EXPECTED_ACTIONS) {
      const schema = schemaFor(plugin, name) as SchemaNode & {
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", `${name} must be an object schema`);
      assert.equal(
        schema.additionalProperties,
        false,
        `${name} must reject unknown fields`,
      );
      const input = VALID_INPUTS[name];
      assert.equal(valid(schema, input), true, `${name} fixture must be valid`);
      assert.equal(
        valid(schema, { ...input, unexpected: true }),
        false,
        `${name} must reject unknown fields`,
      );
    }
  });

  it("enforces every required field and every declared property type", () => {
    const plugin = makeGoogleDrive();
    for (const name of EXPECTED_ACTIONS) {
      const schema = schemaFor(plugin, name) as SchemaNode;
      const fixture = VALID_INPUTS[name];
      for (const required of schema.required ?? []) {
        const without = { ...fixture };
        delete without[required];
        assert.equal(
          valid(schema, without),
          false,
          `${name} must require ${required}`,
        );
      }
      for (const [field, fieldSchema] of Object.entries(
        schema.properties ?? {},
      )) {
        const good = sampleFor(fieldSchema);
        assert.equal(
          valid(fieldSchema, good),
          true,
          `${name}.${field} must accept its representative type`,
        );
        const candidates = [null, "wrong", 42, true, [], {}];
        assert.ok(
          candidates.some((candidate) => !valid(fieldSchema, candidate)),
          `${name}.${field} must reject an incompatible value`,
        );
      }
    }
  });

  it("requires exactly one upload content source and prevents ambiguous updates", () => {
    const plugin = makeGoogleDrive();
    const upload = schemaFor(plugin, "file.upload");
    assert.equal(valid(upload, { contentBase64: "aA==" }), true);
    assert.equal(valid(upload, { contentPath: "/tmp/file" }), true);
    assert.equal(valid(upload, { content: "hello" }), true);
    assert.equal(valid(upload, {}), false);
    assert.equal(
      valid(upload, { contentBase64: "aA==", contentPath: "/tmp/file" }),
      false,
    );

    const update = schemaFor(plugin, "file.update");
    assert.equal(valid(update, { fileId: "file" }), false);
    assert.equal(valid(update, { fileId: "file", fields: "id" }), false);
    assert.equal(
      valid(update, { fileId: "file", keepRevisionForever: true }),
      false,
    );
    assert.equal(
      valid(update, {
        fileId: "file",
        contentPath: "/tmp/file",
        keepRevisionForever: true,
      }),
      true,
    );
    assert.equal(
      valid(update, {
        fileId: "file",
        contentBase64: "aA==",
        contentPath: "/tmp/file",
      }),
      false,
    );
  });

  it("models permission targets and permission roles precisely", () => {
    const plugin = makeGoogleDrive();
    for (const action of ["file.share", "folder.share"] as const) {
      const schema = schemaFor(plugin, action);
      const id =
        action === "file.share" ? { fileId: "file" } : { folderId: "folder" };
      assert.equal(
        valid(schema, {
          ...id,
          role: "writer",
          type: "user",
          emailAddress: "a@example.com",
        }),
        true,
      );
      assert.equal(
        valid(schema, { ...id, role: "reader", type: "user" }),
        false,
      );
      assert.equal(
        valid(schema, {
          ...id,
          role: "reader",
          type: "domain",
          domain: "example.com",
        }),
        true,
      );
      assert.equal(
        valid(schema, {
          ...id,
          role: "reader",
          type: "anyone",
          emailAddress: "a@example.com",
        }),
        false,
      );
      assert.equal(
        valid(schema, { ...id, role: "invalid", type: "anyone" }),
        false,
      );
    }
  });

  it("validates string maps, comment anchors, unions, enums, and pagination", () => {
    const plugin = makeGoogleDrive();
    const upload = schemaFor(plugin, "file.upload");
    assert.equal(
      valid(upload, { content: "x", properties: { client: "acme" } }),
      true,
    );
    assert.equal(
      valid(upload, { content: "x", properties: { client: 1 } }),
      false,
    );

    const comment = schemaFor(plugin, "comment.create");
    assert.equal(
      valid(comment, {
        fileId: "file",
        content: "Comment",
        quotedFileContent: { value: "quote", mimeType: "text/plain" },
      }),
      true,
    );
    assert.equal(
      valid(comment, {
        fileId: "file",
        content: "Comment",
        quotedFileContent: { mimeType: "text/plain" },
      }),
      false,
    );

    const search = schemaFor(plugin, "fileFolder.search");
    assert.equal(
      valid(search, { fields: "id,name", fileTypes: "text/plain" }),
      true,
    );
    assert.equal(
      valid(search, { fields: ["id", "name"], fileTypes: ["text/plain"] }),
      true,
    );
    assert.equal(valid(search, { whatToSearch: "emails" }), false);

    assert.equal(
      valid(schemaFor(plugin, "comment.list"), {
        fileId: "file",
        pageSize: 101,
      }),
      false,
    );
    assert.equal(
      valid(schemaFor(plugin, "revision.list"), {
        fileId: "file",
        pageSize: 1000,
      }),
      true,
    );
    assert.equal(
      valid(schemaFor(plugin, "file.list"), { pageSize: 1.5 }),
      false,
    );
  });

  it("sends trashed as file metadata, including false when untrashing", async () => {
    const plugin = makeGoogleDrive();
    const update = plugin.actions.find(
      (action) => action.name === "file.update",
    );
    assert.ok(update);

    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      request = { url: String(url), init };
      return Response.json({ id: "file", trashed: false });
    }) as typeof fetch;

    const context: ActionContext = {
      connection: {
        name: "googleDrive",
        plugin: "googleDrive",
        config: {
          accessToken: "token",
          accessTokenExpiresAt: Date.now() + 3_600_000,
        },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };

    await update.execute({ fileId: "file", trashed: false }, context);

    assert.ok(request);
    assert.equal(request.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(request.init?.body)), {
      trashed: false,
    });
    assert.equal(new URL(request.url).searchParams.has("trashed"), false);
  });

  it("enforces patch invariants, watches, and access-proposal decisions", () => {
    const plugin = makeGoogleDrive();
    const revision = schemaFor(plugin, "revision.update");
    assert.equal(
      valid(revision, { fileId: "file", revisionId: "revision" }),
      false,
    );
    assert.equal(
      valid(revision, {
        fileId: "file",
        revisionId: "revision",
        published: false,
      }),
      true,
    );

    const permission = schemaFor(plugin, "permission.update");
    assert.equal(
      valid(permission, { fileId: "file", permissionId: "permission" }),
      false,
    );
    assert.equal(
      valid(permission, {
        fileId: "file",
        permissionId: "permission",
        removeExpiration: true,
      }),
      true,
    );
    assert.equal(
      valid(permission, {
        fileId: "file",
        permissionId: "permission",
        removeExpiration: false,
      }),
      false,
    );
    assert.equal(
      valid(permission, {
        fileId: "file",
        permissionId: "permission",
        expirationTime: "not-a-timestamp",
      }),
      false,
    );

    const watch = schemaFor(plugin, "changes.watch");
    assert.equal(
      valid(watch, { pageToken: "token", address: "http://example.com/hook" }),
      false,
    );
    assert.equal(
      valid(watch, {
        pageToken: "token",
        address: "https://example.com/hook",
        expiration: 1.5,
      }),
      false,
    );

    const proposal = schemaFor(plugin, "accessProposal.resolve");
    assert.equal(
      valid(proposal, {
        fileId: "file",
        proposalId: "proposal",
        action: "ACCEPT",
        role: "reader",
      }),
      true,
    );
    assert.equal(
      valid(proposal, {
        fileId: "file",
        proposalId: "proposal",
        action: "DENY",
        role: "reader",
      }),
      false,
    );
    assert.equal(
      valid(proposal, {
        fileId: "file",
        proposalId: "proposal",
        action: "ACCEPT",
        role: "owner",
      }),
      false,
    );
    assert.equal(
      valid(proposal, {
        fileId: "file",
        proposalId: "proposal",
        action: "IGNORE",
      }),
      false,
    );
  });
});
