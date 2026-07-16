import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  assertTimeOrder,
  CRM_BASE,
  CRM_IDENTITY_KIND,
  type CrmPerson,
  createRecordFields,
  enumSchema,
  idSchema,
  listParams,
  paginationFields,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  timestampSchema,
  updateRecordFields,
  withQuery,
} from "./shared.js";

const personListFields = {
  search: t.Optional(
    t.String({ minLength: 1, pattern: "\\S", description: "Name search" }),
  ),
  accountId: t.Optional(idSchema("Filter by affiliated account record ID")),
  includeArchived: t.Optional(t.Boolean()),
  ...paginationFields(),
};

function identitySchema() {
  return t.Object(
    {
      kind: enumSchema("Identity kind", CRM_IDENTITY_KIND),
      value: t.String({
        minLength: 1,
        maxLength: 1_000,
        pattern: "\\S",
        description: "Identity value, e.g. an email address",
      }),
      isPrimary: t.Optional(t.Boolean()),
    },
    { additionalProperties: false },
  );
}

function affiliationSchema() {
  return t.Object(
    {
      accountId: idSchema("Account record ID"),
      title: t.Optional(
        t.String({ minLength: 1, maxLength: 300, pattern: "\\S" }),
      ),
      role: t.Optional(
        t.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
      ),
      isPrimary: t.Optional(t.Boolean()),
      startedAt: t.Optional(timestampSchema("ISO-8601 start timestamp")),
      endedAt: t.Optional(timestampSchema("ISO-8601 end timestamp")),
    },
    { additionalProperties: false },
  );
}

interface PersonDetails {
  identities?: Array<{ kind: string; isPrimary?: boolean }>;
  accounts?: Array<{
    accountId: string;
    isPrimary?: boolean;
    startedAt?: string;
    endedAt?: string;
  }>;
}

function assertPersonDetails(input: PersonDetails): void {
  const primaryKinds = new Set<string>();
  for (const identity of input.identities ?? []) {
    if (!identity.isPrimary) continue;
    if (primaryKinds.has(identity.kind)) {
      throw new Error(
        `A person may have only one primary ${identity.kind} identity`,
      );
    }
    primaryKinds.add(identity.kind);
  }
  const accounts = input.accounts ?? [];
  if (accounts.filter((a) => a.isPrimary && !a.endedAt).length > 1) {
    throw new Error("A person may have only one current primary account");
  }
  if (new Set(accounts.map((a) => a.accountId)).size !== accounts.length) {
    throw new Error("Duplicate account affiliation");
  }
  for (const account of accounts) {
    assertTimeOrder(
      account.startedAt,
      account.endedAt,
      "Affiliation endedAt must not precede startedAt",
    );
  }
}

export function registerPersonActions(rl: RunlinePluginAPI) {
  rl.registerAction("person.list", {
    access: "read",
    description: "List the first page of CRM people.",
    inputSchema: t.Object(personListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ people: CrmPerson[] }>(
        ctx,
        withQuery(`${CRM_BASE}/people`, listParams(input)),
      );
      return body.people;
    },
  });

  rl.registerAction("person.listPage", {
    access: "read",
    description: "List a cursor-paginated page of CRM people.",
    inputSchema: t.Object(personListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ people: CrmPerson[]; nextCursor?: string }>(
        ctx,
        withQuery(`${CRM_BASE}/people`, listParams(input)),
      );
    },
  });

  rl.registerAction("person.get", {
    access: "read",
    description:
      "Get a CRM person with identities and account affiliations by record ID.",
    inputSchema: t.Object({ id: idSchema("Person record ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ person: CrmPerson }>(
        ctx,
        `${CRM_BASE}/people/${pathSegment(id)}`,
      );
      return body.person;
    },
  });

  rl.registerAction("person.create", {
    access: "write",
    description:
      "Create a CRM person with normalized identities (email, phone, WhatsApp, LinkedIn) and account affiliations.",
    inputSchema: t.Object(
      {
        name: t.String({
          minLength: 1,
          maxLength: 300,
          pattern: "\\S",
          description: "Person name",
        }),
        identities: t.Optional(t.Array(identitySchema())),
        accounts: t.Optional(t.Array(affiliationSchema())),
        ...createRecordFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      assertPersonDetails(input as PersonDetails);
      const body = await request<{ person: CrmPerson }>(
        ctx,
        `${CRM_BASE}/people`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.person;
    },
  });

  rl.registerAction("person.update", {
    access: "write",
    description:
      "Update or archive a CRM person. Supplied identities and accounts replace the existing sets.",
    inputSchema: t.Object(
      {
        id: idSchema("Person record ID"),
        name: t.Optional(
          t.String({ minLength: 1, maxLength: 300, pattern: "\\S" }),
        ),
        identities: t.Optional(t.Array(identitySchema())),
        accounts: t.Optional(t.Array(affiliationSchema())),
        ...updateRecordFields(),
      },
      STRICT_UPDATE_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & PersonDetails &
        Record<string, unknown>;
      assertPersonDetails(patch);
      const body = await request<{ person: CrmPerson }>(
        ctx,
        `${CRM_BASE}/people/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.person;
    },
  });
}
