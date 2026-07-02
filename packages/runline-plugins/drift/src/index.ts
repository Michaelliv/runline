import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://driftapi.com";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok)
    throw new Error(`Drift API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function drift(rl: RunlinePluginAPI) {
  rl.setName("drift");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Drift API access token",
      env: "DRIFT_ACCESS_TOKEN",
    },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      name: { type: "string", required: false, description: "Full name" },
      phone: { type: "string", required: false, description: "Phone number" },
    },
    async execute(input, ctx) {
      const { email, name, phone } = input as Record<string, unknown>;
      const attrs: Record<string, unknown> = { email };
      if (name) attrs.name = name;
      if (phone) attrs.phone = phone;
      const data = (await apiRequest(tok(ctx), "POST", "/contacts", {
        attributes: attrs,
      })) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(
        tok(ctx),
        "GET",
        `/contacts/${(input as { contactId: string }).contactId}`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
      email: { type: "string", required: false, description: "New email" },
      name: { type: "string", required: false, description: "New name" },
      phone: { type: "string", required: false, description: "New phone" },
    },
    async execute(input, ctx) {
      const { contactId, email, name, phone } = input as Record<
        string,
        unknown
      >;
      const attrs: Record<string, unknown> = {};
      if (email) attrs.email = email;
      if (name) attrs.name = name;
      if (phone) attrs.phone = phone;
      const data = (await apiRequest(
        tok(ctx),
        "PATCH",
        `/contacts/${contactId}`,
        { attributes: attrs },
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: {
      contactId: { type: "string", required: true, description: "Contact ID" },
    },
    async execute(input, ctx) {
      await apiRequest(
        tok(ctx),
        "DELETE",
        `/contacts/${(input as { contactId: string }).contactId}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("contact.getCustomAttributes", {
    access: "read",
    description: "List all custom contact attributes",
    async execute(_input, ctx) {
      const data = (await apiRequest(
        tok(ctx),
        "GET",
        "/contacts/attributes",
      )) as Record<string, unknown>;
      return (data.data as Record<string, unknown>).properties;
    },
  });
}
