import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { actionNetworkCredential } from "./credentials.js";

/** Public API base, used only for the resource links Action Network expects in bodies. */
const BASE_URL = "https://actionnetwork.org/api/v2";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, actionNetworkCredential, "actionNetwork", {
    target: "api",
    path: endpoint,
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  endpoint: string,
  itemsKey: string,
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  let page = 1;

  while (true) {
    const data = (await apiRequest(ctx, "GET", endpoint, undefined, {
      page,
      per_page: 25,
    })) as {
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

export default function actionNetwork(rl: RunlinePluginAPI) {
  rl.setName("actionNetwork");
  rl.setVersion("0.1.0");
  rl.setCredential(actionNetworkCredential);

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
    access: "write",
    description: "Record a person's attendance at an event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { eventId, personId } = input as {
        eventId: string;
        personId: string;
      };
      const body = {
        _links: {
          "osdi:person": {
            href: `${BASE_URL}/people/${personId}`,
          },
        },
      };
      return apiRequest(
        ctx,
        "POST",
        `events/${pathSegment(eventId)}/attendances`,
        body,
      );
    },
  });

  rl.registerAction("attendance.get", {
    access: "read",
    description: "Get a specific attendance record",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      attendanceId: {
        type: "string",
        required: true,
        description: "Attendance ID",
      },
    },
    async execute(input, ctx) {
      const { eventId, attendanceId } = input as {
        eventId: string;
        attendanceId: string;
      };
      return apiRequest(
        ctx,
        "GET",
        `events/${pathSegment(eventId)}/attendances/${pathSegment(attendanceId)}`,
      );
    },
  });

  rl.registerAction("attendance.list", {
    access: "read",
    description: "List attendances for an event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { eventId, limit } = input as { eventId: string; limit?: number };
      return paginate(
        ctx,
        `events/${pathSegment(eventId)}/attendances`,
        "osdi:attendances",
        limit,
      );
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.create", {
    access: "write",
    description: "Create a new event",
    inputSchema: {
      title: { type: "string", required: true, description: "Event title" },
      originSystem: {
        type: "string",
        required: true,
        description: "Origin system identifier",
      },
      description: {
        type: "string",
        required: false,
        description: "Event description",
      },
    },
    async execute(input, ctx) {
      const { title, originSystem, description, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        title,
        origin_system: originSystem,
      };
      if (description) body.description = description;
      Object.assign(body, rest);
      return apiRequest(ctx, "POST", "events", body);
    },
  });

  rl.registerAction("event.get", {
    access: "read",
    description: "Get a specific event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
    },
    async execute(input, ctx) {
      const { eventId } = input as { eventId: string };
      return apiRequest(ctx, "GET", `events/${pathSegment(eventId)}`);
    },
  });

  rl.registerAction("event.list", {
    access: "read",
    description: "List all events",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "events", "osdi:events", limit);
    },
  });

  // ── Person ──────────────────────────────────────────

  rl.registerAction("person.create", {
    access: "write",
    description: "Create a new person",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      givenName: { type: "string", required: false, description: "First name" },
      familyName: { type: "string", required: false, description: "Last name" },
    },
    async execute(input, ctx) {
      const { email, givenName, familyName, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        person: {
          email_addresses: [
            { address: email, primary: true, status: "subscribed" },
          ],
          ...(givenName ? { given_name: givenName } : {}),
          ...(familyName ? { family_name: familyName } : {}),
          ...rest,
        },
      };
      return apiRequest(ctx, "POST", "people", body);
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
      return apiRequest(ctx, "GET", `people/${pathSegment(personId)}`);
    },
  });

  rl.registerAction("person.list", {
    access: "read",
    description: "List all people",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "people", "osdi:people", limit);
    },
  });

  rl.registerAction("person.update", {
    access: "write",
    description: "Update a person",
    inputSchema: {
      personId: { type: "string", required: true, description: "Person ID" },
      givenName: { type: "string", required: false, description: "First name" },
      familyName: { type: "string", required: false, description: "Last name" },
    },
    async execute(input, ctx) {
      const { personId, givenName, familyName, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { ...rest };
      if (givenName !== undefined) body.given_name = givenName;
      if (familyName !== undefined) body.family_name = familyName;
      return apiRequest(ctx, "PUT", `people/${pathSegment(personId)}`, body);
    },
  });

  // ── Petition ────────────────────────────────────────

  rl.registerAction("petition.create", {
    access: "write",
    description: "Create a new petition",
    inputSchema: {
      title: { type: "string", required: true, description: "Petition title" },
      originSystem: {
        type: "string",
        required: true,
        description: "Origin system identifier",
      },
      target: {
        type: "string",
        required: false,
        description: "Comma-separated list of targets",
      },
    },
    async execute(input, ctx) {
      const { title, originSystem, target, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {
        title,
        origin_system: originSystem,
        ...rest,
      };
      if (target) {
        body.target = (target as string)
          .split(",")
          .map((t) => ({ name: t.trim() }));
      }
      return apiRequest(ctx, "POST", "petitions", body);
    },
  });

  rl.registerAction("petition.get", {
    access: "read",
    description: "Get a specific petition",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
    },
    async execute(input, ctx) {
      const { petitionId } = input as { petitionId: string };
      return apiRequest(ctx, "GET", `petitions/${pathSegment(petitionId)}`);
    },
  });

  rl.registerAction("petition.list", {
    access: "read",
    description: "List all petitions",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "petitions", "osdi:petitions", limit);
    },
  });

  rl.registerAction("petition.update", {
    access: "write",
    description: "Update a petition",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
      title: { type: "string", required: false, description: "Petition title" },
      target: {
        type: "string",
        required: false,
        description: "Comma-separated list of targets",
      },
    },
    async execute(input, ctx) {
      const { petitionId, target, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...rest };
      if (target) {
        body.target = (target as string)
          .split(",")
          .map((t) => ({ name: t.trim() }));
      }
      return apiRequest(
        ctx,
        "PUT",
        `petitions/${pathSegment(petitionId)}`,
        body,
      );
    },
  });

  // ── Signature ───────────────────────────────────────

  rl.registerAction("signature.create", {
    access: "write",
    description: "Add a signature to a petition",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
      personId: { type: "string", required: true, description: "Person ID" },
    },
    async execute(input, ctx) {
      const { petitionId, personId } = input as {
        petitionId: string;
        personId: string;
      };
      const body = {
        _links: {
          "osdi:person": { href: `${BASE_URL}/people/${personId}` },
        },
      };
      return apiRequest(
        ctx,
        "POST",
        `petitions/${pathSegment(petitionId)}/signatures`,
        body,
      );
    },
  });

  rl.registerAction("signature.get", {
    access: "read",
    description: "Get a specific signature",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
      signatureId: {
        type: "string",
        required: true,
        description: "Signature ID",
      },
    },
    async execute(input, ctx) {
      const { petitionId, signatureId } = input as {
        petitionId: string;
        signatureId: string;
      };
      return apiRequest(
        ctx,
        "GET",
        `petitions/${pathSegment(petitionId)}/signatures/${pathSegment(signatureId)}`,
      );
    },
  });

  rl.registerAction("signature.list", {
    access: "read",
    description: "List signatures on a petition",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { petitionId, limit } = input as {
        petitionId: string;
        limit?: number;
      };
      return paginate(
        ctx,
        `petitions/${pathSegment(petitionId)}/signatures`,
        "osdi:signatures",
        limit,
      );
    },
  });

  rl.registerAction("signature.update", {
    access: "write",
    description: "Update a signature",
    inputSchema: {
      petitionId: {
        type: "string",
        required: true,
        description: "Petition ID",
      },
      signatureId: {
        type: "string",
        required: true,
        description: "Signature ID",
      },
    },
    async execute(input, ctx) {
      const { petitionId, signatureId, ...rest } = input as Record<
        string,
        unknown
      >;
      return apiRequest(
        ctx,
        "PUT",
        `petitions/${pathSegment(petitionId)}/signatures/${pathSegment(signatureId)}`,
        rest,
      );
    },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    access: "write",
    description: "Create a new tag",
    inputSchema: {
      name: { type: "string", required: true, description: "Tag name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      return apiRequest(ctx, "POST", "tags", { name });
    },
  });

  rl.registerAction("tag.get", {
    access: "read",
    description: "Get a specific tag",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
    },
    async execute(input, ctx) {
      const { tagId } = input as { tagId: string };
      return apiRequest(ctx, "GET", `tags/${pathSegment(tagId)}`);
    },
  });

  rl.registerAction("tag.list", {
    access: "read",
    description: "List all tags",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results to return",
      },
    },
    async execute(input, ctx) {
      const { limit } = (input as { limit?: number }) ?? {};
      return paginate(ctx, "tags", "osdi:tags", limit);
    },
  });

  // ── Person Tag ──────────────────────────────────────

  rl.registerAction("personTag.add", {
    access: "write",
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
        ctx,
        "POST",
        `tags/${pathSegment(tagId)}/taggings`,
        body,
      );
    },
  });

  rl.registerAction("personTag.remove", {
    access: "write",
    description: "Remove a tag from a person",
    inputSchema: {
      tagId: { type: "string", required: true, description: "Tag ID" },
      taggingId: { type: "string", required: true, description: "Tagging ID" },
    },
    async execute(input, ctx) {
      const { tagId, taggingId } = input as {
        tagId: string;
        taggingId: string;
      };
      return apiRequest(
        ctx,
        "DELETE",
        `tags/${pathSegment(tagId)}/taggings/${pathSegment(taggingId)}`,
      );
    },
  });
}
