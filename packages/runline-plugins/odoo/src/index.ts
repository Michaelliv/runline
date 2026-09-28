import { type ActionContext, AuthError, type RunlinePluginAPI } from "runline";
import { answerFailed, credentialJson } from "../../_shared/credentials.js";
import { odooCredential } from "./credentials.js";

/**
 * One JSON-RPC call. Every Odoo service takes the password as its third
 * argument, so `args` carries null there for the transport to fill.
 */
async function rpc(
  ctx: ActionContext,
  service: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const answer = await credentialJson<{
    result?: unknown;
    error?: {
      code?: unknown;
      message?: unknown;
      data?: { name?: unknown; message?: unknown };
    };
  }>(ctx, odooCredential, "odoo", {
    target: "rpc",
    path: "jsonrpc",
    method: "POST",
    json: {
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args },
      id: 1,
    },
  });
  if (answer.error)
    throw answerFailed("odoo", {
      code: answer.error.data?.name ?? answer.error.code,
      message: answer.error.data?.message ?? answer.error.message,
    });
  return answer.result;
}

/** The database the connection names, else the instance's first host label. */
function database(config: Readonly<Record<string, unknown>>): string {
  if (typeof config.db === "string" && config.db) return config.db;
  try {
    return new URL(String(config.url)).hostname.split(".")[0];
  } catch {
    throw new AuthError("invalid_credentials");
  }
}

/** The database and the logged-in user's ID, which every model call names. */
async function session(
  ctx: ActionContext,
): Promise<{ db: string; uid: number }> {
  const db = database(ctx.connection.config);
  const uid = await rpc(ctx, "common", "login", [
    db,
    ctx.connection.config.username,
    null,
  ]);
  if (typeof uid !== "number") throw new AuthError("invalid_credentials");
  return { db, uid };
}

/** A method on a model, as the logged-in user. */
async function call(
  ctx: ActionContext,
  model: string,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  const { db, uid } = await session(ctx);
  return rpc(ctx, "object", "execute", [db, uid, null, model, method, ...args]);
}

const MODEL_MAP: Record<string, string> = {
  contact: "res.partner",
  opportunity: "crm.lead",
  note: "note.note",
};

function resolveModel(resource: string): string {
  return MODEL_MAP[resource] ?? resource;
}

export default function odoo(rl: RunlinePluginAPI) {
  rl.setName("odoo");
  rl.setVersion("0.1.0");
  rl.setCredential(odooCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Odoo instance URL (e.g. https://mycompany.odoo.com)",
      env: "ODOO_URL",
    },
    db: {
      type: "string",
      required: false,
      description: "Database name (auto-detected from URL if omitted)",
      env: "ODOO_DB",
    },
    username: {
      type: "string",
      required: true,
      description: "Odoo username (email)",
      env: "ODOO_USERNAME",
    },
    password: {
      type: "string",
      required: true,
      description: "Odoo password or API key",
      env: "ODOO_PASSWORD",
    },
  });

  rl.registerAction("record.create", {
    access: "write",
    description:
      "Create a record in any Odoo model (contact, opportunity, note, or custom model name)",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description:
          "Model: contact, opportunity, note, or Odoo model name (e.g. res.partner)",
      },
      fields: {
        type: "object",
        required: true,
        description: "Fields to set on the new record",
      },
    },
    async execute(input, ctx) {
      const { model, fields } = input as Record<string, unknown>;
      const id = await call(
        ctx,
        resolveModel(model as string),
        "create",
        fields,
      );
      return { id };
    },
  });

  rl.registerAction("record.get", {
    access: "read",
    description: "Read a record by ID",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description: "Model: contact, opportunity, note, or Odoo model name",
      },
      id: { type: "number", required: true, description: "Record ID" },
      fields: {
        type: "object",
        required: false,
        description: "Array of field names to return (default: all)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const fieldsToRead = (p.fields as string[]) ?? [];
      return call(
        ctx,
        resolveModel(p.model as string),
        "read",
        [p.id],
        fieldsToRead,
      );
    },
  });

  rl.registerAction("record.list", {
    access: "read",
    description: "Search and read records from any Odoo model",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description: "Model: contact, opportunity, note, or Odoo model name",
      },
      filters: {
        type: "object",
        required: false,
        description: 'Array of filter tuples, e.g. [["name", "like", "test"]]',
      },
      fields: {
        type: "object",
        required: false,
        description: "Array of field names to return",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max records (0 = no limit)",
      },
      offset: {
        type: "number",
        required: false,
        description: "Offset for pagination",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const filters = (p.filters as unknown[]) ?? [];
      const fields = (p.fields as string[]) ?? [];
      const offset = (p.offset as number) ?? 0;
      const limit = (p.limit as number) ?? 0;
      return call(
        ctx,
        resolveModel(p.model as string),
        "search_read",
        filters,
        fields,
        offset,
        limit,
      );
    },
  });

  rl.registerAction("record.update", {
    access: "write",
    description: "Update a record by ID",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description: "Model: contact, opportunity, note, or Odoo model name",
      },
      id: { type: "number", required: true, description: "Record ID" },
      fields: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await call(
        ctx,
        resolveModel(p.model as string),
        "write",
        [p.id],
        p.fields,
      );
      return { id: p.id };
    },
  });

  rl.registerAction("record.delete", {
    access: "write",
    description: "Delete a record by ID",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description: "Model: contact, opportunity, note, or Odoo model name",
      },
      id: { type: "number", required: true, description: "Record ID" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await call(ctx, resolveModel(p.model as string), "unlink", [p.id]);
      return { success: true };
    },
  });

  rl.registerAction("model.getFields", {
    access: "read",
    description: "Get field definitions for an Odoo model",
    inputSchema: {
      model: {
        type: "string",
        required: true,
        description: "Model: contact, opportunity, note, or Odoo model name",
      },
    },
    async execute(input, ctx) {
      const { model } = input as Record<string, unknown>;
      return call(
        ctx,
        resolveModel(model as string),
        "fields_get",
        [],
        ["string", "type", "help", "required", "name"],
      );
    },
  });
}
