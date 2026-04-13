import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://actionnetwork.org/api/v2";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "OSDI-API-Token": apiKey,
    },
  };
  if (body && Object.keys(body).length > 0) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Action Network API error ${res.status}: ${text}`);
  }
  if (res.status === 204) return { ok: true };
  return res.json();
}

async function paginate(
  apiKey: string,
  endpoint: string,
  itemsKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;

  while (true) {
    const data = (await apiRequest(apiKey, "GET", `${endpoint}?page=${page}&per_page=25`)) as {
      _embedded?: Record<string, unknown[]>;
      _links?: { next?: { href: string } };
    };

    const items = data._embedded?.[itemsKey] ?? [];
    results.push(...items);

    if (limit && results.length >= limit) return results.slice(0, limit);
    if (!data._links?.next) break;
    page++;
  }

  return results;
}

function itemsKeyForEndpoint(endpoint: string): string {
  const segment = endpoint.split("/").pop()!;
  return `osdi:${segment}`;
}

function extractId(item: { _links?: { self?: { href?: string } } }): string {
  return item._links?.self?.href?.split("/").pop() ?? "";
}

export default function actionNetwork(rl: RunlinePluginAPI) {
  rl.setName("actionNetwork");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Action Network API key",
      env: "ACTION_NETWORK_API_KEY",
    },
  });

  // ── Attendance ──────────────────────────────────────

  rl.registerAction("attendance.create", {
    description: "Record a person's attendance at an event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { eventId, personId } = input as { eventId: string; personId: string };
      const body = {
        _links: {
          "osdi:person": {
            href: `${BASE_URL}/people/${personId}`,
          },
        },
      };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "POST",
        `/events/${eventId}/attendances`,
        body,
      );
    },
  });

  rl.registerAction("attendance.get", {
    description: "Get a specific attendance record",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      attendanceId: { type: "string", required: true, description: "Attendance ID" },
    },
    async execute(input, ctx) {
      const { eventId, attendanceId } = input as { eventId: string; attendanceId: string };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "GET",
        `/events/${eventId}/attendances/${attendanceId}`,
      );
    },
  });

  rl.registerAction("attendance.list", {
    description: "List attendances for an event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { eventId, limit } = input as { eventId: string; limit?: number };
      return paginate(
        ctx.connection.config.apiKey as string,
        `/events/${eventId}/attendances`,
        "osdi:attendances",
        limit,
      );
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.create", {
    description: "Create a new event",
    inputSchema: {
      title: { type: "string", required: true, description: "Event title" },
      originSystem: { type: "string", required: true, description: "Origin system identifier" },
      description: { type: "string", required: false, description: "Event description" },
    },
    async execute(input, ctx) {
      const { title, originSystem, description, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title, origin_system: originSystem };
      if (description) body.description = description;
      Object.assign(body, rest);
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/events", body);
    },
  });

  rl.registerAction("event.get", {
    description: "Get a specific event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
    },
    async execute(input, ctx) {
      const { eventId } = input as { eventId: string };
      return apiRequest(ctx.connection.config.apiKey as string, "GET", `/events/${eventId}`);
    },
  });

  rl.registerAction("event.list", {
    description: "List all events",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx.connection.config.apiKey as string, "/events", "osdi:events", limit);
    },
  });

  // ── Person ──────────────────────────────────────────

  rl.registerAction("person.create", {
    description: "Create a new person",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      givenName: { type: "string", required: false, description: "First name" },
      familyName: { type: "string", required: false, description: "Last name" },
    },
    async execute(input, ctx) {
      const { email, givenName, familyName, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        person: {
          email_addresses: [{ address: email, primary: true, status: "subscribed" }],
          ...(givenName ? { given_name: givenName } : {}),
          ...(familyName ? { family_name: familyName } : {}),
          ...rest,
        },
      };
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/people", body);
    },
  });

  rl.registerAction("person.get", {
    description: "Get a specific person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { personId } = input as { personId: string };
      return apiRequest(ctx.connection.config.apiKey as string, "GET", `/people/${personId}`);
    },
  });

  rl.registerAction("person.list", {
    description: "List all people",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx.connection.config.apiKey as string, "/people", "osdi:people", limit);
    },
  });

  rl.registerAction("person.update", {
    description: "Update a person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
      givenName: { type: "string", required: false, description: "First name" },
      familyName: { type: "string", required: false, description: "Last name" },
    },
    async execute(input, ctx) {
      const { personId, givenName, familyName, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (givenName !== undefined) body.given_name = givenName;
      if (familyName !== undefined) body.family_name = familyName;
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "PUT",
        `/people/${personId}`,
        body,
      );
    },
  });

  // ── Petition ────────────────────────────────────────

  rl.registerAction("petition.create", {
    description: "Create a new petition",
    inputSchema: {
      title: { type: "string", required: true, description: "Petition title" },
      originSystem: { type: "string", required: true, description: "Origin system identifier" },
      target: { type: "string", required: false, description: "Comma-separated list of targets" },
    },
    async execute(input, ctx) {
      const { title, originSystem, target, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { title, origin_system: originSystem, ...rest };
      if (target) {
        body.target = (target as string).split(",").map((t) => ({ name: t.trim() }));
      }
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/petitions", body);
    },
  });

  rl.registerAction("petition.get", {
    description: "Get a specific petition",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
    },
    async execute(input, ctx) {
      const { petitionId } = input as { petitionId: string };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "GET",
        `/petitions/${petitionId}`,
      );
    },
  });

  rl.registerAction("petition.list", {
    description: "List all petitions",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(
        ctx.connection.config.apiKey as string,
        "/petitions",
        "osdi:petitions",
        limit,
      );
    },
  });

  rl.registerAction("petition.update", {
    description: "Update a petition",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
      title: { type: "string", required: false, description: "Petition title" },
      target: { type: "string", required: false, description: "Comma-separated list of targets" },
    },
    async execute(input, ctx) {
      const { petitionId, target, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (target) {
        body.target = (target as string).split(",").map((t) => ({ name: t.trim() }));
      }
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "PUT",
        `/petitions/${petitionId}`,
        body,
      );
    },
  });

  // ── Signature ───────────────────────────────────────

  rl.registerAction("signature.create", {
    description: "Add a signature to a petition",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { petitionId, personId } = input as { petitionId: string; personId: string };
      const body = {
        _links: {
          "osdi:person": { href: `${BASE_URL}/people/${personId}` },
        },
      };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "POST",
        `/petitions/${petitionId}/signatures`,
        body,
      );
    },
  });

  rl.registerAction("signature.get", {
    description: "Get a specific signature",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
      signatureId: { type: "string", required: true, description: "Signature ID" },
    },
    async execute(input, ctx) {
      const { petitionId, signatureId } = input as { petitionId: string; signatureId: string };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "GET",
        `/petitions/${petitionId}/signatures/${signatureId}`,
      );
    },
  });

  rl.registerAction("signature.list", {
    description: "List signatures on a petition",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { petitionId, limit } = input as { petitionId: string; limit?: number };
      return paginate(
        ctx.connection.config.apiKey as string,
        `/petitions/${petitionId}/signatures`,
        "osdi:signatures",
        limit,
      );
    },
  });

  rl.registerAction("signature.update", {
    description: "Update a signature",
    inputSchema: {
      petitionId: { type: "string", required: true, description: "Petition ID" },
      signatureId: { type: "string", required: true, description: "Signature ID" },
    },
    async execute(input, ctx) {
      const { petitionId, signatureId, ...rest } = input as Record<string, unknown>;
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "PUT",
        `/petitions/${petitionId}/signatures/${signatureId}`,
        rest,
      );
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    description: "Create a new tag",
    inputSchema: {
      name: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/tags", { name });
    },
  });

  rl.registerAction("tag.get", {
    description: "Get a specific tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      return apiRequest(ctx.connection.config.apiKey as string, "GET", `/tags/${tagId}`);
    },
  });

  rl.registerAction("tag.list", {
    description: "List all tags",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results to return" },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx.connection.config.apiKey as string, "/tags", "osdi:tags", limit);
    },
  });

  // ── Person Tag ──────────────────────────────────────

  rl.registerAction("personTag.add", {
    description: "Add a tag to a person",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { tagId, personId } = input as { tagId: string; personId: string };
      const body = {
        _links: {
          "osdi:person": { href: `${BASE_URL}/people/${personId}` },
        },
      };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "POST",
        `/tags/${tagId}/taggings`,
        body,
      );
    },
  });

  rl.registerAction("personTag.remove", {
    description: "Remove a tag from a person",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      taggingId: { type: "string", required: true, description: "Tagging ID" },
    },
    async execute(input, ctx) {
      const { tagId, taggingId } = input as { tagId: string; taggingId: string };
      return apiRequest(
        ctx.connection.config.apiKey as string,
        "DELETE",
        `/tags/${tagId}/taggings/${taggingId}`,
      );
    },
  });
}
