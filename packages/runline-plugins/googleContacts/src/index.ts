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
 * the bare ID and normalize, and either way the ID is one path
 * segment. The response always includes a convenience `contactId`
 * field stripped from `resourceName`.
 */

import {
  type ActionContext,
  pathSegment,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";
import {
  googleCredential,
  googleJsonRequest,
  googleListAll,
  googleOAuth,
} from "../../_shared/googleAuth.js";
import {
  googleConnection,
  Id,
  NonEmptyString,
  optionalBoolean,
  optionalString,
  PositiveInteger,
} from "../../_shared/googleSchemas.js";
import { arr, obj } from "../../_shared/provider.js";
import { atLeastOne, strictObject, stringEnum } from "../../_shared/schemas.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

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

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://people.googleapis.com/v1";

async function peopleRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return googleJsonRequest(
    ctx,
    "googleContacts",
    SCOPES,
    method,
    `${API_BASE}${path}`,
    body,
    qs,
  );
}

function paginateAll(
  ctx: Ctx,
  path: string,
  key: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  return googleListAll(
    (query) => peopleRequest(ctx, "GET", path, undefined, query),
    key,
    { ...qs, pageSize: qs.pageSize ?? 100 },
  );
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a contact identifier into a `people/<id>` resourceName.
 * Accepts either the raw ID (`c1234…`) or the full prefixed form.
 */
function normalizeContactResource(input: string): string {
  const id = input.startsWith("people/")
    ? input.slice("people/".length)
    : input;
  return `people/${pathSegment(id)}`;
}

function normalizeGroupResource(input: string): string {
  const id = input.startsWith("contactGroups/")
    ? input.slice("contactGroups/".length)
    : input;
  return `contactGroups/${pathSegment(id)}`;
}

function contactIdFromResource(resourceName: unknown): string | undefined {
  return typeof resourceName === "string" && resourceName
    ? resourceName.split("/").pop()
    : undefined;
}

/**
 * Resolve a `fields: "*" | string | string[]` argument to a
 * comma-separated list of valid People-API field names.
 */
function resolvePersonFields(input: string | string[] | undefined): string {
  if (!input) return "names,emailAddresses,phoneNumbers";
  const fields = typeof input === "string" ? [input] : input;
  return (fields.includes("*") ? ALL_PERSON_FIELDS : fields).join(",");
}

/**
 * Accept an ISO date / timestamp string or a `{year, month, day}`
 * object and return the Google-native structured date shape. A
 * `year: 0` indicates "no year" (common for recurring events).
 */
function coerceDate(
  v: string | { year?: number; month: number; day: number },
): { year?: number; month: number; day: number } {
  if (typeof v !== "string") return v;
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

type ContactInput = t.Static<t.TObject<typeof contactWritableFields>>;

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
    if (input.honorificPrefix !== undefined)
      name.honorificPrefix = input.honorificPrefix;
    if (input.honorificSuffix !== undefined)
      name.honorificSuffix = input.honorificSuffix;
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

/** A person, with the ID its `resourceName` ends in as `contactId`. */
function attachContactId(person: unknown) {
  const fields = obj(person);
  return { ...fields, contactId: contactIdFromResource(fields.resourceName) };
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/contacts"];

const personField = stringEnum([...ALL_PERSON_FIELDS, "*"] as const);
const personFields = t.Optional(
  t.Union([t.String(), t.Array(personField, { minItems: 1 })]),
);
const structuredDate = strictObject({
  year: t.Optional(t.Integer({ minimum: 0 })),
  month: t.Integer({ minimum: 1, maximum: 12 }),
  day: t.Integer({ minimum: 1, maximum: 31 }),
});
const contactDate = t.Union([NonEmptyString, structuredDate]);
const typedValue = strictObject({
  value: NonEmptyString,
  type: optionalString(),
});
const relation = strictObject({
  person: NonEmptyString,
  type: optionalString(),
});
const contactEvent = strictObject({
  date: contactDate,
  type: optionalString(),
});
const userDefined = strictObject({ key: NonEmptyString, value: t.String() });
// These two People API resources are open: the fields named here are typed,
// and whatever else the API takes passes through.
const address = t.Object(
  {
    formattedValue: optionalString(),
    type: optionalString(),
    poBox: optionalString(),
    streetAddress: optionalString(),
    extendedAddress: optionalString(),
    city: optionalString(),
    region: optionalString(),
    postalCode: optionalString(),
    country: optionalString(),
    countryCode: optionalString(),
  },
  { additionalProperties: true },
);
const organization = t.Object(
  {
    name: optionalString(),
    title: optionalString(),
    department: optionalString(),
    type: optionalString(),
    symbol: optionalString(),
    domain: optionalString(),
    location: optionalString(),
    jobDescription: optionalString(),
    phoneticName: optionalString(),
    costCenter: optionalString(),
    fullTimeEquivalentMillipercent: t.Optional(
      t.Integer({ minimum: 0, maximum: 100_000 }),
    ),
    startDate: t.Optional(structuredDate),
    endDate: t.Optional(structuredDate),
    current: optionalBoolean,
  },
  { additionalProperties: true },
);
const clientData = strictObject({ key: NonEmptyString, value: t.String() });
const contactWritableFields = {
  givenName: optionalString(),
  familyName: optionalString(),
  middleName: optionalString(),
  honorificPrefix: optionalString(),
  honorificSuffix: optionalString(),
  phoneNumbers: t.Optional(t.Array(typedValue)),
  emailAddresses: t.Optional(t.Array(typedValue)),
  addresses: t.Optional(t.Array(address)),
  organizations: t.Optional(t.Array(organization)),
  relations: t.Optional(t.Array(relation)),
  urls: t.Optional(t.Array(typedValue)),
  events: t.Optional(t.Array(contactEvent)),
  birthday: t.Optional(contactDate),
  biography: optionalString(),
  userDefined: t.Optional(t.Array(userDefined)),
  groups: t.Optional(t.Array(NonEmptyString)),
};

const contactSchemas = {
  create: strictObject(contactWritableFields),
  get: strictObject({ contactId: Id, fields: personFields }),
  list: strictObject({
    query: optionalString(),
    fields: personFields,
    sortOrder: t.Optional(
      stringEnum([
        "LAST_MODIFIED_ASCENDING",
        "LAST_MODIFIED_DESCENDING",
        "FIRST_NAME_ASCENDING",
        "LAST_NAME_ASCENDING",
      ] as const),
    ),
    returnAll: optionalBoolean,
    maxResults: t.Optional(PositiveInteger),
    pageToken: optionalString(),
  }),
  update: strictObject(
    {
      contactId: Id,
      etag: optionalString(),
      fields: personFields,
      ...contactWritableFields,
    },
    atLeastOne(contactWritableFields),
  ),
  delete: strictObject({ contactId: Id }),
};

const groupChanges = {
  name: optionalString(),
  clientData: t.Optional(t.Array(clientData)),
};
const groupSchemas = {
  list: strictObject({
    returnAll: optionalBoolean,
    maxResults: t.Optional(PositiveInteger),
    pageToken: optionalString(),
    syncToken: optionalString(),
  }),
  get: strictObject({
    groupId: Id,
    maxMembers: t.Optional(t.Integer({ minimum: 0 })),
  }),
  create: strictObject({
    name: NonEmptyString,
    clientData: t.Optional(t.Array(clientData)),
  }),
  update: strictObject(
    { groupId: Id, etag: optionalString(), ...groupChanges },
    atLeastOne(groupChanges),
  ),
  delete: strictObject({ groupId: Id, deleteContacts: optionalBoolean }),
};

export default function googleContacts(rl: RunlinePluginAPI) {
  rl.setName("googleContacts");
  rl.setVersion("0.1.0");
  rl.setCredential(googleCredential("googleContacts", SCOPES));

  rl.setOAuth(googleOAuth("googleContacts", SCOPES, "GOOGLE_CONTACTS"));

  rl.setConnectionSchema(t.Object(googleConnection("GOOGLE_CONTACTS")));

  // ── Contact ───────────────────────────────────────────

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a new contact",
    inputSchema: contactSchemas.create,
    async execute(p, ctx) {
      const { body } = buildPersonBody(p);
      return attachContactId(
        await peopleRequest(ctx, "POST", "/people:createContact", body),
      );
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: contactSchemas.get,
    async execute(p, ctx) {
      const resource = normalizeContactResource(p.contactId);
      return attachContactId(
        await peopleRequest(ctx, "GET", `/${resource}`, undefined, {
          personFields: resolvePersonFields(p.fields),
        }),
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description:
      "List contacts (people/me/connections) or search them. When `query` is set, hits people:searchContacts; otherwise returns the user's connections.",
    inputSchema: contactSchemas.list,
    async execute(p, ctx) {
      const useSearch = Boolean(p.query);
      const endpoint = useSearch
        ? "/people:searchContacts"
        : "/people/me/connections";
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

      // The People API caches searches server-side, and a first search
      // often answers nothing: an empty one warms the cache.
      if (useSearch && !p.pageToken) {
        await peopleRequest(ctx, "GET", endpoint, undefined, {
          query: "",
          readMask: "names",
        });
      }

      // A search answers results that hold a person; a list, the people.
      const key = useSearch ? "results" : "connections";
      const people = (items: unknown[]) =>
        items.map((item) =>
          attachContactId(useSearch ? obj(item).person : item),
        );

      if (p.returnAll) return people(await paginateAll(ctx, endpoint, key, qs));
      if (p.maxResults) qs.pageSize = p.maxResults;
      const page = obj(
        await peopleRequest(ctx, "GET", endpoint, undefined, qs),
      );
      return people(arr(page[key]));
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description:
      "Update a contact. Only supplied fields are sent; etag is resolved automatically if not provided.",
    inputSchema: contactSchemas.update,
    async execute(p, ctx) {
      const resource = normalizeContactResource(p.contactId);

      let etag = p.etag;
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

      const { body, touchedFields } = buildPersonBody(p, etag);
      const qs: Record<string, unknown> = {
        updatePersonFields: touchedFields.join(","),
        personFields: resolvePersonFields(p.fields),
      };
      return attachContactId(
        await peopleRequest(
          ctx,
          "PATCH",
          `/${resource}:updateContact`,
          body,
          qs,
        ),
      );
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: contactSchemas.delete,
    async execute(p, ctx) {
      const resource = normalizeContactResource(p.contactId);
      await peopleRequest(ctx, "DELETE", `/${resource}:deleteContact`);
      return { success: true };
    },
  });

  // ── Contact groups ────────────────────────────────────

  rl.registerAction("group.list", {
    access: "read",
    description:
      "List contact groups (including system groups like 'myContacts' and 'starred')",
    inputSchema: groupSchemas.list,
    async execute(p, ctx) {
      const qs: Record<string, unknown> = {};
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.syncToken) qs.syncToken = p.syncToken;
      if (p.returnAll)
        return paginateAll(ctx, "/contactGroups", "contactGroups", qs);
      if (p.maxResults) qs.pageSize = p.maxResults;
      const res = (await peopleRequest(
        ctx,
        "GET",
        "/contactGroups",
        undefined,
        qs,
      )) as {
        contactGroups?: unknown[];
      };
      return res.contactGroups ?? [];
    },
  });

  rl.registerAction("group.get", {
    access: "read",
    description: "Get a contact group by ID",
    inputSchema: groupSchemas.get,
    async execute(p, ctx) {
      const resource = normalizeGroupResource(p.groupId);
      const qs: Record<string, unknown> = {};
      if (p.maxMembers !== undefined) qs.maxMembers = p.maxMembers;
      return peopleRequest(ctx, "GET", `/${resource}`, undefined, qs);
    },
  });

  rl.registerAction("group.create", {
    access: "write",
    description: "Create a contact group",
    inputSchema: groupSchemas.create,
    async execute(p, ctx) {
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
    access: "write",
    description:
      "Update a contact group. Pass a fresh `etag` or let the plugin resolve it automatically.",
    inputSchema: groupSchemas.update,
    async execute(p, ctx) {
      const resource = normalizeGroupResource(p.groupId);
      let etag = p.etag;
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
      return peopleRequest(ctx, "PUT", `/${resource}`, {
        contactGroup,
        updateGroupFields: updateGroupFields.join(","),
      });
    },
  });

  rl.registerAction("group.delete", {
    access: "write",
    description:
      "Delete a contact group. Pass `deleteContacts=true` to also delete every contact in the group.",
    inputSchema: groupSchemas.delete,
    async execute(p, ctx) {
      const resource = normalizeGroupResource(p.groupId);
      const qs: Record<string, unknown> = {};
      if (p.deleteContacts) qs.deleteContacts = p.deleteContacts;
      await peopleRequest(ctx, "DELETE", `/${resource}`, undefined, qs);
      return { success: true };
    },
  });
}
