import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment as seg,
} from "../../_shared/credentials.js";
import { affinityCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, affinityCredential, "affinity", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  path: string,
  dataKey: string,
  limit?: number,
  extraQuery?: Record<string, unknown>,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let pageToken: string | undefined;

  while (true) {
    const qs: Record<string, unknown> = { ...extraQuery, page_size: 500 };
    if (pageToken) qs.page_token = pageToken;

    const data = (await apiRequest(ctx, "GET", path, undefined, qs)) as Record<
      string,
      unknown
    >;
    const items = (data[dataKey] as unknown[]) ?? [];
    results.push(...items);

    if (limit && results.length >= limit) return results.slice(0, limit);

    pageToken = data.page_token as string | undefined;
    if (!pageToken) break;
  }

  return results;
}

export default function affinity(rl: RunlinePluginAPI) {
  rl.setName("affinity");
  rl.setVersion("0.1.0");
  rl.setCredential(affinityCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Affinity API key",
      env: "AFFINITY_API_KEY",
    },
  });

  // ── List ────────────────────────────────────────────

  rl.registerAction("list.get", {
    access: "read",
    description: "Get a specific list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
    },
    async execute(input, ctx) {
      const { listId } = input as { listId: string };
      return apiRequest(ctx, "GET", `lists/${seg(listId)}`);
    },
  });

  rl.registerAction("list.list", {
    access: "read",
    description: "List all lists",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      const data = (await apiRequest(ctx, "GET", "lists")) as unknown[];
      if (limit) return data.slice(0, limit);
      return data;
    },
  });

  // ── List Entry ──────────────────────────────────────

  rl.registerAction("listEntry.create", {
    access: "write",
    description: "Create a new list entry",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      entityId: {
        type: "number",
        required: true,
        description: "Entity ID to add",
      },
    },
    async execute(input, ctx) {
      const { listId, entityId, ...rest } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", `lists/${seg(listId)}/list-entries`, {
        entity_id: entityId,
        ...rest,
      });
    },
  });

  rl.registerAction("listEntry.get", {
    access: "read",
    description: "Get a specific list entry",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      listEntryId: {
        type: "string",
        required: true,
        description: "List Entry ID",
      },
    },
    async execute(input, ctx) {
      const { listId, listEntryId } = input as {
        listId: string;
        listEntryId: string;
      };
      return apiRequest(
        ctx,
        "GET",
        `lists/${seg(listId)}/list-entries/${seg(listEntryId)}`,
      );
    },
  });

  rl.registerAction("listEntry.list", {
    access: "read",
    description: "List all entries in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { listId, limit } = input as { listId: string; limit?: number };
      return paginateAll(
        ctx,
        `lists/${seg(listId)}/list-entries`,
        "list_entries",
        limit,
      );
    },
  });

  rl.registerAction("listEntry.delete", {
    access: "write",
    description: "Delete a list entry",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      listEntryId: {
        type: "string",
        required: true,
        description: "List Entry ID",
      },
    },
    async execute(input, ctx) {
      const { listId, listEntryId } = input as {
        listId: string;
        listEntryId: string;
      };
      return apiRequest(
        ctx,
        "DELETE",
        `lists/${seg(listId)}/list-entries/${seg(listEntryId)}`,
      );
    },
  });

  // ── Person ──────────────────────────────────────────

  rl.registerAction("person.create", {
    access: "write",
    description: "Create a new person",
    inputSchema: {
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: true, description: "Last name" },
      emails: {
        type: "array",
        required: true,
        description: "Array of email addresses",
      },
      organizationIds: {
        type: "array",
        required: false,
        description: "Array of organization IDs",
      },
    },
    async execute(input, ctx) {
      const { firstName, lastName, emails, organizationIds } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
        emails,
      };
      if (organizationIds) body.organization_ids = organizationIds;
      return apiRequest(ctx, "POST", "persons", body);
    },
  });

  rl.registerAction("person.get", {
    access: "read",
    description: "Get a specific person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { personId } = input as { personId: string };
      return apiRequest(ctx, "GET", `persons/${seg(personId)}`);
    },
  });

  rl.registerAction("person.list", {
    access: "read",
    description: "Search/list persons",
    inputSchema: {
      term: { type: "string", required: false, description: "Search term" },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { term, limit } =
        (input as { term?: string; limit?: number }) ?? {};
      return paginateAll(
        ctx,
        "persons",
        "persons",
        limit,
        term ? { term } : undefined,
      );
    },
  });

  rl.registerAction("person.update", {
    access: "write",
    description: "Update a person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
      emails: {
        type: "array",
        required: true,
        description: "Array of email addresses",
      },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      organizationIds: {
        type: "array",
        required: false,
        description: "Array of organization IDs",
      },
    },
    async execute(input, ctx) {
      const { personId, firstName, lastName, emails, organizationIds } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { emails };
      if (firstName) body.first_name = firstName;
      if (lastName) body.last_name = lastName;
      if (organizationIds) body.organization_ids = organizationIds;
      return apiRequest(ctx, "PUT", `persons/${seg(personId)}`, body);
    },
  });

  rl.registerAction("person.delete", {
    access: "write",
    description: "Delete a person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { personId } = input as { personId: string };
      return apiRequest(ctx, "DELETE", `persons/${seg(personId)}`);
    },
  });

  // ── Organization ────────────────────────────────────

  rl.registerAction("organization.create", {
    access: "write",
    description: "Create a new organization",
    inputSchema: {
      name: {
        type: "string",
        required: true,
        description: "Organization name",
      },
      domain: {
        type: "string",
        required: true,
        description: "Organization domain",
      },
      personIds: {
        type: "array",
        required: false,
        description: "Array of person IDs",
      },
    },
    async execute(input, ctx) {
      const { name, domain, personIds } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, domain };
      if (personIds) body.person_ids = personIds;
      return apiRequest(ctx, "POST", "organizations", body);
    },
  });

  rl.registerAction("organization.get", {
    access: "read",
    description: "Get a specific organization",
    inputSchema: {
      organizationId: {
        type: "string",
        required: true,
        description: "Organization ID",
      },
    },
    async execute(input, ctx) {
      const { organizationId } = input as { organizationId: string };
      return apiRequest(ctx, "GET", `organizations/${seg(organizationId)}`);
    },
  });

  rl.registerAction("organization.list", {
    access: "read",
    description: "Search/list organizations",
    inputSchema: {
      term: { type: "string", required: false, description: "Search term" },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { term, limit } =
        (input as { term?: string; limit?: number }) ?? {};
      return paginateAll(
        ctx,
        "organizations",
        "organizations",
        limit,
        term ? { term } : undefined,
      );
    },
  });

  rl.registerAction("organization.update", {
    access: "write",
    description: "Update an organization",
    inputSchema: {
      organizationId: {
        type: "string",
        required: true,
        description: "Organization ID",
      },
      name: {
        type: "string",
        required: false,
        description: "Organization name",
      },
      domain: {
        type: "string",
        required: false,
        description: "Organization domain",
      },
      personIds: {
        type: "array",
        required: false,
        description: "Array of person IDs",
      },
    },
    async execute(input, ctx) {
      const { organizationId, name, domain, personIds } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (domain) body.domain = domain;
      if (personIds) body.person_ids = personIds;
      return apiRequest(
        ctx,
        "PUT",
        `organizations/${seg(organizationId)}`,
        body,
      );
    },
  });

  rl.registerAction("organization.delete", {
    access: "write",
    description: "Delete an organization",
    inputSchema: {
      organizationId: {
        type: "string",
        required: true,
        description: "Organization ID",
      },
    },
    async execute(input, ctx) {
      const { organizationId } = input as { organizationId: string };
      return apiRequest(ctx, "DELETE", `organizations/${seg(organizationId)}`);
    },
  });
}
