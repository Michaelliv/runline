/**
 * Google Contacts (People API) plugin for runline.
 *
 * OAuth2 user flow, same shape as the rest of the Google plugins.
 * Scope: `auth/contacts` (full read/write on user's contacts).
 *
 * Surface area:
 *
 *   contact.create / contact.get / contact.update / contact.delete
 *   contact.list            (me/connections or search via people:searchContacts)
 *
 *   group.list / group.get / group.create / group.update / group.delete
 *
 * Birthdays and events accept either a plain ISO date string
 * (`"1990-03-14"`, `"2024-12-25T10:00:00Z"`) or Google's structured
 * `{year, month, day}` object. Phone numbers, emails, addresses,
 * organizations, relations, user-defined fields, and memberships
 * pass through as arrays of Google's People-API entries.
 *
 * The People API uses `resourceName` ("people/c1234…") as the
 * canonical identifier; we accept either the full `resourceName` or
 * the bare ID and normalize. The response always includes a
 * convenience `contactId` field stripped from `resourceName`.
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import { googleAccessToken } from "../../_shared/googleAuth.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleContactsConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

// ─── Fields ─────────────────────────────────────────────────────

/**
 * Every `personFields` value supported by People API get/list calls.
 * Callers pass `fields: "*"` to request them all, or a specific
 * subset as either a string or array.
 */
const ALL_PERSON_FIELDS = [
  "addresses",
  "biographies",
  "birthdays",
  "coverPhotos",
  "emailAddresses",
  "events",
  "genders",
  "imClients",
  "interests",
  "locales",
  "memberships",
  "metadata",
  "names",
  "nicknames",
  "occupations",
  "organizations",
  "phoneNumbers",
  "photos",
  "relations",
  "residences",
  "sipAddresses",
  "skills",
  "urls",
  "userDefined",
] as const;

/**
 * Fields that People API accepts on PATCH `updatePersonFields`.
 * Matches the request schema — `metadata`, `photos`, `coverPhotos`,
 * `locales`, `genders`, and `nicknames` aren't writable here.
 */
const UPDATABLE_PERSON_FIELDS = new Set([
  "addresses",
  "biographies",
  "birthdays",
  "emailAddresses",
  "events",
  "imClients",
  "interests",
  "memberships",
  "names",
  "occupations",
  "organizations",
  "phoneNumbers",
  "relations",
  "sipAddresses",
  "skills",
  "urls",
  "userDefined",
]);

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleContacts", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://people.googleapis.com/v1";

async function peopleRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${API_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const entry of v) url.searchParams.append(k, String(entry));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`googleContacts: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

async function paginateAll(
  ctx: Ctx,
  path: string,
  key: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = { ...qs, pageSize: qs.pageSize ?? 100 };
  do {
    const page = (await peopleRequest(ctx, "GET", path, undefined, query)) as {
      [k: string]: unknown;
      nextPageToken?: string;
    };
    const items = (page[key] as Record<string, unknown>[]) ?? [];
    out.push(...items);
    query.pageToken = page.nextPageToken;
  } while (query.pageToken);
  return out;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a contact identifier into a `people/<id>` resourceName.
 * Accepts either the raw ID (`c1234…`) or the full prefixed form.
 */
function normalizeContactResource(input: string): string {
  if (!input) throw new Error("googleContacts: contact ID is required");
  return input.startsWith("people/") ? input : `people/${input}`;
}

function normalizeGroupResource(input: string): string {
  if (!input) throw new Error("googleContacts: group ID is required");
  return input.startsWith("contactGroups/") ? input : `contactGroups/${input}`;
}

function contactIdFromResource(resourceName: string | undefined): string | undefined {
  if (!resourceName) return undefined;
  const parts = resourceName.split("/");
  return parts[parts.length - 1];
}

/**
 * Resolve a `fields: "*" | string | string[]` argument to a
 * comma-separated list of valid People-API field names.
 */
function resolvePersonFields(input: unknown): string {
  if (!input) return "names,emailAddresses,phoneNumbers";
  if (Array.isArray(input)) {
    if (input.includes("*")) return ALL_PERSON_FIELDS.join(",");
    return input.join(",");
  }
  if (typeof input === "string") {
    if (input === "*") return ALL_PERSON_FIELDS.join(",");
    return input;
  }
  return "names,emailAddresses,phoneNumbers";
}

/**
 * Accept an ISO date / timestamp string or a `{year, month, day}`
 * object and return the Google-native structured date shape. A
 * `year: 0` indicates "no year" (common for recurring events).
 */
function coerceDate(v: unknown): { year?: number; month: number; day: number } {
  if (v && typeof v === "object" && "day" in (v as object) && "month" in (v as object)) {
    return v as { year?: number; month: number; day: number };
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`googleContacts: invalid date "${v}"`);
    }
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
    };
  }
  throw new Error("googleContacts: date must be an ISO string or {year, month, day}");
}

interface ContactInput {
  // Name
  givenName?: string;
  familyName?: string;
  middleName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  // Collections
  phoneNumbers?: Array<{ value: string; type?: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  addresses?: Array<Record<string, unknown>>;
  organizations?: Array<Record<string, unknown>>;
  relations?: Array<{ person: string; type?: string }>;
  urls?: Array<{ value: string; type?: string }>;
  events?: Array<{ date: unknown; type?: string }>;
  userDefined?: Array<{ key: string; value: string }>;
  // Single / structured
  birthday?: unknown;
  biography?: string;
  // Memberships (group IDs or resourceNames)
  groups?: string[];
}

/**
 * Build a People-API `Person` body from our flat-ish input shape.
 * Returns the body alongside the list of `personFields` that were
 * actually populated — used for `updatePersonFields` on PATCH.
 */
function buildPersonBody(
  input: ContactInput,
  etag?: string,
): { body: Record<string, unknown>; touchedFields: string[] } {
  const body: Record<string, unknown> = {};
  const touched: string[] = [];
  if (etag) body.etag = etag;

  const hasName =
    input.givenName !== undefined ||
    input.familyName !== undefined ||
    input.middleName !== undefined ||
    input.honorificPrefix !== undefined ||
    input.honorificSuffix !== undefined;
  if (hasName) {
    const name: Record<string, unknown> = {};
    if (input.givenName !== undefined) name.givenName = input.givenName;
    if (input.familyName !== undefined) name.familyName = input.familyName;
    if (input.middleName !== undefined) name.middleName = input.middleName;
    if (input.honorificPrefix !== undefined) name.honorificPrefix = input.honorificPrefix;
    if (input.honorificSuffix !== undefined) name.honorificSuffix = input.honorificSuffix;
    body.names = [name];
    touched.push("names");
  }

  if (input.phoneNumbers) {
    body.phoneNumbers = input.phoneNumbers;
    touched.push("phoneNumbers");
  }
  if (input.emailAddresses) {
    body.emailAddresses = input.emailAddresses;
    touched.push("emailAddresses");
  }
  if (input.addresses) {
    body.addresses = input.addresses;
    touched.push("addresses");
  }
  if (input.organizations) {
    body.organizations = input.organizations;
    touched.push("organizations");
  }
  if (input.relations) {
    body.relations = input.relations;
    touched.push("relations");
  }
  if (input.urls) {
    body.urls = input.urls;
    touched.push("urls");
  }

  if (input.events) {
    body.events = input.events.map((e) => ({
      date: coerceDate(e.date),
      ...(e.type ? { type: e.type } : {}),
    }));
    touched.push("events");
  }
  if (input.birthday !== undefined) {
    body.birthdays = [{ date: coerceDate(input.birthday) }];
    touched.push("birthdays");
  }
  if (input.biography !== undefined) {
    body.biographies = [{ value: input.biography, contentType: "TEXT_PLAIN" }];
    touched.push("biographies");
  }
  if (input.userDefined) {
    body.userDefined = input.userDefined;
    touched.push("userDefined");
  }

  if (input.groups) {
    body.memberships = input.groups.map((g) => ({
      contactGroupMembership: {
        contactGroupResourceName: normalizeGroupResource(g),
      },
    }));
    touched.push("memberships");
  }

  return { body, touchedFields: touched };
}

function attachContactId<T extends { resourceName?: string }>(
  obj: T,
): T & { contactId?: string } {
  return { ...obj, contactId: contactIdFromResource(obj.resourceName) };
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/contacts"];

export default function googleContacts(rl: RunlinePluginAPI) {
  rl.setName("googleContacts");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the People API:",
      "     https://console.cloud.google.com/apis/library/people.googleapis.com",
      "",
      "3. Configure the OAuth consent screen:",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_CONTACTS_CLIENT_ID and GOOGLE_CONTACTS_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, env: "GOOGLE_CONTACTS_CLIENT_ID" },
    clientSecret: { type: "string", required: false, env: "GOOGLE_CONTACTS_CLIENT_SECRET" },
    refreshToken: { type: "string", required: false, env: "GOOGLE_CONTACTS_REFRESH_TOKEN" },
    serviceAccountJson: { type: "string", required: false, env: "GOOGLE_CONTACTS_SERVICE_ACCOUNT_JSON" },
    serviceAccountEmail: { type: "string", required: false, env: "GOOGLE_CONTACTS_SERVICE_ACCOUNT_EMAIL" },
    serviceAccountPrivateKey: { type: "string", required: false, env: "GOOGLE_CONTACTS_SERVICE_ACCOUNT_PRIVATE_KEY" },
    serviceAccountSubject: { type: "string", required: false, env: "GOOGLE_CONTACTS_SERVICE_ACCOUNT_SUBJECT" },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Contact ───────────────────────────────────────────

  rl.registerAction("contact.create", {
    description: "Create a new contact",
    inputSchema: {
      givenName: { type: "string", required: false },
      familyName: { type: "string", required: false },
      middleName: { type: "string", required: false },
      honorificPrefix: { type: "string", required: false },
      honorificSuffix: { type: "string", required: false },
      phoneNumbers: {
        type: "array",
        required: false,
        description: "[{value, type?}]",
      },
      emailAddresses: {
        type: "array",
        required: false,
        description: "[{value, type?}]",
      },
      addresses: {
        type: "array",
        required: false,
        description: "[{formattedValue?, streetAddress?, city?, region?, postalCode?, country?, type?}]",
      },
      organizations: {
        type: "array",
        required: false,
        description: "[{name, title?, department?, type?}]",
      },
      relations: {
        type: "array",
        required: false,
        description: "[{person, type?}]",
      },
      urls: { type: "array", required: false },
      events: {
        type: "array",
        required: false,
        description:
          "[{date, type?}] — date can be ISO string or {year, month, day}",
      },
      birthday: {
        type: "string",
        required: false,
        description: "ISO date string or {year, month, day}",
      },
      biography: { type: "string", required: false },
      userDefined: {
        type: "array",
        required: false,
        description: "[{key, value}] — custom key/value pairs",
      },
      groups: {
        type: "array",
        required: false,
        description: "Group IDs or full contactGroups/… resource names",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as unknown as ContactInput;
      const { body } = buildPersonBody(p);
      const res = (await peopleRequest(
        ctx,
        "POST",
        "/people:createContact",
        body,
      )) as { resourceName?: string };
      return attachContactId(res);
    },
  });

  rl.registerAction("contact.get", {
    description: "Get a contact by ID",
    inputSchema: {
      contactId: {
        type: "string",
        required: true,
        description: "Bare ID or full people/… resource name",
      },
      fields: {
        type: "string",
        required: false,
        description:
          "'*' (all), comma-separated string, or array of People-API field names (default: names, emailAddresses, phoneNumbers)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeContactResource(p.contactId as string);
      const res = (await peopleRequest(
        ctx,
        "GET",
        `/${resource}`,
        undefined,
        { personFields: resolvePersonFields(p.fields) },
      )) as { resourceName?: string };
      return attachContactId(res);
    },
  });

  rl.registerAction("contact.list", {
    description:
      "List contacts (people/me/connections) or search them. When `query` is set, hits people:searchContacts; otherwise returns the user's connections.",
    inputSchema: {
      query: {
        type: "string",
        required: false,
        description: "If set, uses people:searchContacts instead of connections.list",
      },
      fields: { type: "string", required: false },
      sortOrder: {
        type: "string",
        required: false,
        description:
          "LAST_MODIFIED_ASCENDING | LAST_MODIFIED_DESCENDING | FIRST_NAME_ASCENDING | LAST_NAME_ASCENDING (connections.list only)",
      },
      returnAll: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const useSearch = typeof p.query === "string" && p.query.length > 0;
      const endpoint = useSearch ? "/people:searchContacts" : "/people/me/connections";
      const fields = resolvePersonFields(p.fields);
      const qs: Record<string, unknown> = {};
      if (useSearch) {
        qs.query = p.query;
        qs.readMask = fields;
      } else {
        qs.personFields = fields;
        if (p.sortOrder) qs.sortOrder = p.sortOrder;
      }
      if (p.pageToken) qs.pageToken = p.pageToken;

      // The People API caches searches server-side; first call often
      // returns empty. Warm up when searching. Not needed for
      // connections.list but cheap and identical request otherwise.
      if (useSearch && !p.pageToken) {
        await peopleRequest(ctx, "GET", endpoint, undefined, {
          query: "",
          readMask: "names",
        });
      }

      const extractItems = (page: Record<string, unknown>): Record<string, unknown>[] => {
        if (useSearch) {
          const results = (page.results as Array<{ person: Record<string, unknown> }> | undefined) ?? [];
          return results.map((r) => r.person);
        }
        return (page.connections as Record<string, unknown>[]) ?? [];
      };

      if (p.returnAll) {
        // Use paginateAll-ish loop that knows about the two shapes.
        const out: Record<string, unknown>[] = [];
        const query: Record<string, unknown> = { ...qs, pageSize: 100 };
        do {
          const page = (await peopleRequest(ctx, "GET", endpoint, undefined, query)) as {
            nextPageToken?: string;
          };
          out.push(...extractItems(page as Record<string, unknown>));
          query.pageToken = page.nextPageToken;
        } while (query.pageToken);
        return out.map((c) =>
          attachContactId(c as { resourceName?: string } & Record<string, unknown>),
        );
      }

      if (p.maxResults) qs.pageSize = p.maxResults;
      const page = (await peopleRequest(ctx, "GET", endpoint, undefined, qs)) as Record<
        string,
        unknown
      >;
      const items = extractItems(page);
      return items.map((c) =>
        attachContactId(c as { resourceName?: string } & Record<string, unknown>),
      );
    },
  });

  rl.registerAction("contact.update", {
    description:
      "Update a contact. Only supplied fields are sent; etag is resolved automatically if not provided.",
    inputSchema: {
      contactId: { type: "string", required: true },
      etag: {
        type: "string",
        required: false,
        description:
          "Optimistic-concurrency tag. If omitted, the plugin fetches the latest etag first.",
      },
      fields: {
        type: "string",
        required: false,
        description: "personFields projection on the response (same semantics as contact.get)",
      },
      // Writable fields
      givenName: { type: "string", required: false },
      familyName: { type: "string", required: false },
      middleName: { type: "string", required: false },
      honorificPrefix: { type: "string", required: false },
      honorificSuffix: { type: "string", required: false },
      phoneNumbers: { type: "array", required: false },
      emailAddresses: { type: "array", required: false },
      addresses: { type: "array", required: false },
      organizations: { type: "array", required: false },
      relations: { type: "array", required: false },
      urls: { type: "array", required: false },
      events: { type: "array", required: false },
      birthday: { type: "string", required: false },
      biography: { type: "string", required: false },
      userDefined: { type: "array", required: false },
      groups: { type: "array", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeContactResource(p.contactId as string);

      let etag = p.etag as string | undefined;
      if (!etag) {
        const existing = (await peopleRequest(
          ctx,
          "GET",
          `/${resource}`,
          undefined,
          { personFields: "names" },
        )) as { etag?: string };
        etag = existing.etag;
      }

      const { body, touchedFields } = buildPersonBody(p as unknown as ContactInput, etag);
      // Filter to fields People API actually accepts on updatePersonFields.
      const updateMask = touchedFields.filter((f) => UPDATABLE_PERSON_FIELDS.has(f));
      if (updateMask.length === 0) {
        throw new Error("googleContacts: no updatable fields supplied");
      }

      const qs: Record<string, unknown> = {
        updatePersonFields: updateMask.join(","),
        personFields: resolvePersonFields(p.fields),
      };
      const res = (await peopleRequest(
        ctx,
        "PATCH",
        `/${resource}:updateContact`,
        body,
        qs,
      )) as { resourceName?: string };
      return attachContactId(res);
    },
  });

  rl.registerAction("contact.delete", {
    description: "Delete a contact",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeContactResource(p.contactId as string);
      await peopleRequest(ctx, "DELETE", `/${resource}:deleteContact`);
      return { success: true };
    },
  });

  // ── Contact groups ────────────────────────────────────

  rl.registerAction("group.list", {
    description: "List contact groups (including system groups like 'myContacts' and 'starred')",
    inputSchema: {
      returnAll: { type: "boolean", required: false },
      maxResults: { type: "number", required: false },
      pageToken: { type: "string", required: false },
      syncToken: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.syncToken) qs.syncToken = p.syncToken;
      if (p.returnAll) return paginateAll(ctx, "/contactGroups", "contactGroups", qs);
      if (p.maxResults) qs.pageSize = p.maxResults;
      const res = (await peopleRequest(ctx, "GET", "/contactGroups", undefined, qs)) as {
        contactGroups?: unknown[];
      };
      return res.contactGroups ?? [];
    },
  });

  rl.registerAction("group.get", {
    description: "Get a contact group by ID",
    inputSchema: {
      groupId: { type: "string", required: true },
      maxMembers: {
        type: "number",
        required: false,
        description: "Include up to N member resourceNames in the response",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeGroupResource(p.groupId as string);
      const qs: Record<string, unknown> = {};
      if (p.maxMembers !== undefined) qs.maxMembers = p.maxMembers;
      return peopleRequest(ctx, "GET", `/${resource}`, undefined, qs);
    },
  });

  rl.registerAction("group.create", {
    description: "Create a contact group",
    inputSchema: {
      name: { type: "string", required: true },
      clientData: {
        type: "array",
        required: false,
        description: "[{key, value}] — app-private metadata",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {
        contactGroup: {
          name: p.name,
          ...(p.clientData ? { clientData: p.clientData } : {}),
        },
      };
      return peopleRequest(ctx, "POST", "/contactGroups", body);
    },
  });

  rl.registerAction("group.update", {
    description:
      "Update a contact group. Pass a fresh `etag` or let the plugin resolve it automatically.",
    inputSchema: {
      groupId: { type: "string", required: true },
      name: { type: "string", required: false },
      clientData: { type: "array", required: false },
      etag: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeGroupResource(p.groupId as string);
      let etag = p.etag as string | undefined;
      if (!etag) {
        const existing = (await peopleRequest(ctx, "GET", `/${resource}`)) as {
          etag?: string;
        };
        etag = existing.etag;
      }
      const updateGroupFields: string[] = [];
      const contactGroup: Record<string, unknown> = { etag };
      if (p.name !== undefined) {
        contactGroup.name = p.name;
        updateGroupFields.push("name");
      }
      if (p.clientData !== undefined) {
        contactGroup.clientData = p.clientData;
        updateGroupFields.push("clientData");
      }
      if (updateGroupFields.length === 0) {
        throw new Error("googleContacts: nothing to update on group");
      }
      return peopleRequest(ctx, "PUT", `/${resource}`, {
        contactGroup,
        updateGroupFields: updateGroupFields.join(","),
      });
    },
  });

  rl.registerAction("group.delete", {
    description:
      "Delete a contact group. Pass `deleteContacts=true` to also delete every contact in the group.",
    inputSchema: {
      groupId: { type: "string", required: true },
      deleteContacts: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const resource = normalizeGroupResource(p.groupId as string);
      const qs: Record<string, unknown> = {};
      if (p.deleteContacts) qs.deleteContacts = p.deleteContacts;
      await peopleRequest(ctx, "DELETE", `/${resource}`, undefined, qs);
      return { success: true };
    },
  });
}
