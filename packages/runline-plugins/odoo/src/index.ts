import type { RunlinePluginAPI } from "runline";

interface Conn {
  config: Record<string, unknown>;
}

function getConn(ctx: { connection: Conn }) {
  const c = ctx.connection.config;
  return {
    url: (c.url as string).replace(/\/$/, ""),
    db: c.db as string | undefined,
    username: c.username as string,
    password: c.password as string,
  };
}

function getDBName(db: string | undefined, url: string): string {
  if (db) return db;
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

async function jsonRpc(url: string, params: unknown): Promise<unknown> {
  const body = {
    jsonrpc: "2.0",
    method: "call",
    params,
    id: Math.floor(Math.random() * 1000),
  };
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Odoo HTTP error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) {
    const err = json.error as Record<string, unknown>;
    const data = (err.data ?? err) as Record<string, unknown>;
    throw new Error(`Odoo RPC error: ${data.message ?? JSON.stringify(err)}`);
  }
  return json.result;
}

async function login(
  url: string,
  db: string,
  username: string,
  password: string,
): Promise<number> {
  const uid = (await jsonRpc(url, {
    service: "common",
    method: "login",
    args: [db, username, password],
  })) as number;
  if (!uid) throw new Error("Odoo login failed — check credentials");
  return uid;
}

async function execute(
  url: string,
  db: string,
  uid: number,
  password: string,
  model: string,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  return jsonRpc(url, {
    service: "object",
    method: "execute",
    args: [db, uid, password, model, method, ...args],
  });
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

  // Helper to get authenticated session
  async function getSession(ctx: { connection: Conn }) {
    const c = getConn(ctx);
    const db = getDBName(c.db, c.url);
    const uid = await login(c.url, db, c.username, c.password);
    return { url: c.url, db, uid, password: c.password };
  }

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
      const s = await getSession(ctx);
      const id = await execute(
        s.url,
        s.db,
        s.uid,
        s.password,
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
      const s = await getSession(ctx);
      const fieldsToRead = (p.fields as string[]) ?? [];
      return execute(
        s.url,
        s.db,
        s.uid,
        s.password,
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
      const s = await getSession(ctx);
      const filters = (p.filters as unknown[]) ?? [];
      const fields = (p.fields as string[]) ?? [];
      const offset = (p.offset as number) ?? 0;
      const limit = (p.limit as number) ?? 0;
      return execute(
        s.url,
        s.db,
        s.uid,
        s.password,
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
      const s = await getSession(ctx);
      await execute(
        s.url,
        s.db,
        s.uid,
        s.password,
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
      const s = await getSession(ctx);
      await execute(
        s.url,
        s.db,
        s.uid,
        s.password,
        resolveModel(p.model as string),
        "unlink",
        [p.id],
      );
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
      const s = await getSession(ctx);
      return execute(
        s.url,
        s.db,
        s.uid,
        s.password,
        resolveModel(model as string),
        "fields_get",
        [],
        ["string", "type", "help", "required", "name"],
      );
    },
  });
}
