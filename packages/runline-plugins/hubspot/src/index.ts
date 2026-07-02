import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.hubapi.com";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
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
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`HubSpot API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function hubspot(rl: RunlinePluginAPI) {
  rl.setName("hubspot");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "HubSpot private app access token",
      env: "HUBSPOT_ACCESS_TOKEN",
    },
  });

  const tok = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.accessToken as string;

  // Helper for CRM objects (contacts, companies, deals, tickets)
  function registerCrmObject(resource: string, objectType: string) {
    rl.registerAction(`${resource}.create`, {
      access: "write",
      description: `Create a ${resource}`,
      inputSchema: {
        properties: {
          type: "object",
          required: true,
          description: "Properties as key-value pairs",
        },
      },
      async execute(input, ctx) {
        return apiRequest(tok(ctx), "POST", `/crm/v3/objects/${objectType}`, {
          properties: (input as { properties: Record<string, unknown> })
            .properties,
        });
      },
    });
    rl.registerAction(`${resource}.get`, {
      access: "read",
      description: `Get a ${resource}`,
      inputSchema: {
        id: { type: "string", required: true, description: `${resource} ID` },
        properties: {
          type: "array",
          required: false,
          description: "Properties to return",
        },
      },
      async execute(input, ctx) {
        const { id, properties } = input as Record<string, unknown>;
        const qs: Record<string, unknown> = {};
        if (properties && Array.isArray(properties))
          qs.properties = (properties as string[]).join(",");
        return apiRequest(
          tok(ctx),
          "GET",
          `/crm/v3/objects/${objectType}/${id}`,
          undefined,
          qs,
        );
      },
    });
    rl.registerAction(`${resource}.list`, {
      access: "read",
      description: `List ${resource}s`,
      inputSchema: {
        limit: {
          type: "number",
          required: false,
          description: "Max results (max 100)",
        },
        after: {
          type: "string",
          required: false,
          description: "Pagination cursor",
        },
        properties: {
          type: "array",
          required: false,
          description: "Properties to return",
        },
      },
      async execute(input, ctx) {
        const { limit, after, properties } = (input ?? {}) as Record<
          string,
          unknown
        >;
        const qs: Record<string, unknown> = {};
        if (limit) qs.limit = limit;
        if (after) qs.after = after;
        if (properties && Array.isArray(properties))
          qs.properties = (properties as string[]).join(",");
        return apiRequest(
          tok(ctx),
          "GET",
          `/crm/v3/objects/${objectType}`,
          undefined,
          qs,
        );
      },
    });
    rl.registerAction(`${resource}.update`, {
      access: "write",
      description: `Update a ${resource}`,
      inputSchema: {
        id: { type: "string", required: true, description: `${resource} ID` },
        properties: {
          type: "object",
          required: true,
          description: "Properties to update",
        },
      },
      async execute(input, ctx) {
        const { id, properties } = input as {
          id: string;
          properties: Record<string, unknown>;
        };
        return apiRequest(
          tok(ctx),
          "PATCH",
          `/crm/v3/objects/${objectType}/${id}`,
          { properties },
        );
      },
    });
    rl.registerAction(`${resource}.delete`, {
      access: "write",
      description: `Delete a ${resource}`,
      inputSchema: {
        id: { type: "string", required: true, description: `${resource} ID` },
      },
      async execute(input, ctx) {
        await apiRequest(
          tok(ctx),
          "DELETE",
          `/crm/v3/objects/${objectType}/${(input as { id: string }).id}`,
        );
        return { success: true };
      },
    });
    rl.registerAction(`${resource}.search`, {
      access: "read",
      description: `Search ${resource}s`,
      inputSchema: {
        filterGroups: {
          type: "array",
          required: true,
          description:
            "Filter groups [{filters: [{propertyName, operator, value}]}]",
        },
        properties: {
          type: "array",
          required: false,
          description: "Properties to return",
        },
        limit: { type: "number", required: false, description: "Max results" },
        after: { type: "string", required: false, description: "Pagination" },
      },
      async execute(input, ctx) {
        const { filterGroups, properties, limit, after } = input as Record<
          string,
          unknown
        >;
        const body: Record<string, unknown> = { filterGroups };
        if (properties) body.properties = properties;
        if (limit) body.limit = limit;
        if (after) body.after = after;
        return apiRequest(
          tok(ctx),
          "POST",
          `/crm/v3/objects/${objectType}/search`,
          body,
        );
      },
    });
  }

  registerCrmObject("contact", "contacts");
  registerCrmObject("company", "companies");
  registerCrmObject("deal", "deals");
  registerCrmObject("ticket", "tickets");

  // ── Contact List ────────────────────────────────────

  rl.registerAction("contactList.addContacts", {
    access: "write",
    description: "Add contacts to a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactIds: {
        type: "array",
        required: true,
        description: "Array of contact IDs",
      },
    },
    async execute(input, ctx) {
      const { listId, contactIds } = input as {
        listId: string;
        contactIds: number[];
      };
      return apiRequest(tok(ctx), "POST", `/contacts/v1/lists/${listId}/add`, {
        vids: contactIds,
      });
    },
  });

  rl.registerAction("contactList.removeContacts", {
    access: "write",
    description: "Remove contacts from a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactIds: {
        type: "array",
        required: true,
        description: "Array of contact IDs",
      },
    },
    async execute(input, ctx) {
      const { listId, contactIds } = input as {
        listId: string;
        contactIds: number[];
      };
      return apiRequest(
        tok(ctx),
        "POST",
        `/contacts/v1/lists/${listId}/remove`,
        { vids: contactIds },
      );
    },
  });

  // ── Engagement ──────────────────────────────────────

  rl.registerAction("engagement.create", {
    access: "write",
    description: "Create an engagement (note, email, task, meeting, call)",
    inputSchema: {
      type: {
        type: "string",
        required: true,
        description: "NOTE, EMAIL, TASK, MEETING, CALL",
      },
      properties: {
        type: "object",
        required: true,
        description: "Engagement metadata",
      },
      associations: {
        type: "object",
        required: false,
        description: "{contactIds, companyIds, dealIds, ticketIds}",
      },
    },
    async execute(input, ctx) {
      const { type, properties, associations } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        engagement: { type, ...(properties as Record<string, unknown>) },
      };
      if (associations) body.associations = associations;
      return apiRequest(tok(ctx), "POST", "/engagements/v1/engagements", body);
    },
  });

  rl.registerAction("engagement.get", {
    access: "read",
    description: "Get an engagement",
    inputSchema: {
      engagementId: {
        type: "string",
        required: true,
        description: "Engagement ID",
      },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "GET",
        `/engagements/v1/engagements/${(input as { engagementId: string }).engagementId}`,
      );
    },
  });

  rl.registerAction("engagement.list", {
    access: "read",
    description: "List engagements",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      offset: { type: "number", required: false, description: "Offset" },
    },
    async execute(input, ctx) {
      const { limit, offset } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (offset) qs.offset = offset;
      return apiRequest(
        tok(ctx),
        "GET",
        "/engagements/v1/engagements/paged",
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("engagement.delete", {
    access: "write",
    description: "Delete an engagement",
    inputSchema: {
      engagementId: {
        type: "string",
        required: true,
        description: "Engagement ID",
      },
    },
    async execute(input, ctx) {
      await apiRequest(
        tok(ctx),
        "DELETE",
        `/engagements/v1/engagements/${(input as { engagementId: string }).engagementId}`,
      );
      return { success: true };
    },
  });

  // ── Form ────────────────────────────────────────────

  rl.registerAction("form.submit", {
    access: "write",
    description: "Submit a HubSpot form",
    inputSchema: {
      portalId: {
        type: "string",
        required: true,
        description: "Portal (Hub) ID",
      },
      formId: { type: "string", required: true, description: "Form GUID" },
      fields: {
        type: "array",
        required: true,
        description: "Array of {name, value} objects",
      },
      context: {
        type: "object",
        required: false,
        description: "Submission context (hutk, pageUri, pageName)",
      },
    },
    async execute(input, ctx) {
      const { portalId, formId, fields, context } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { fields };
      if (context) body.context = context;
      return apiRequest(
        tok(ctx),
        "POST",
        `/submissions/v3/integration/secure/submit/${portalId}/${formId}`,
        body,
      );
    },
  });

  rl.registerAction("form.getFields", {
    access: "read",
    description: "Get form fields",
    inputSchema: {
      formId: { type: "string", required: true, description: "Form GUID" },
    },
    async execute(input, ctx) {
      return apiRequest(
        tok(ctx),
        "GET",
        `/forms/v2/fields/${(input as { formId: string }).formId}`,
      );
    },
  });
}
