import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_BASE,
  type CrmAccount,
  createRecordFields,
  idSchema,
  listParams,
  paginationFields,
  pathSegment,
  request,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
  updateRecordFields,
  withQuery,
} from "./shared.js";

const accountListFields = {
  search: t.Optional(
    t.String({ minLength: 1, pattern: "\\S", description: "Name search" }),
  ),
  accountType: t.Optional(
    t.String({ minLength: 1, description: "Account type filter" }),
  ),
  lifecycleStage: t.Optional(
    t.String({ minLength: 1, description: "Lifecycle stage filter" }),
  ),
  includeArchived: t.Optional(t.Boolean()),
  ...paginationFields(),
};

function nullableString(maxLength: number, description: string) {
  return t.Optional(
    t.Union([
      t.String({ minLength: 1, maxLength, pattern: "\\S", description }),
      t.Null(),
    ]),
  );
}

export function registerAccountActions(rl: RunlinePluginAPI) {
  rl.registerAction("account.list", {
    access: "read",
    description: "List the first page of CRM accounts.",
    inputSchema: t.Object(accountListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      const body = await request<{ accounts: CrmAccount[] }>(
        ctx,
        withQuery(`${CRM_BASE}/accounts`, listParams(input)),
      );
      return body.accounts;
    },
  });

  rl.registerAction("account.listPage", {
    access: "read",
    description: "List a cursor-paginated page of CRM accounts.",
    inputSchema: t.Object(accountListFields, STRICT_OBJECT),
    async execute(input, ctx) {
      return request<{ accounts: CrmAccount[]; nextCursor?: string }>(
        ctx,
        withQuery(`${CRM_BASE}/accounts`, listParams(input)),
      );
    },
  });

  rl.registerAction("account.get", {
    access: "read",
    description: "Get a CRM account by record ID.",
    inputSchema: t.Object({ id: idSchema("Account record ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ account: CrmAccount }>(
        ctx,
        `${CRM_BASE}/accounts/${pathSegment(id)}`,
      );
      return body.account;
    },
  });

  rl.registerAction("account.create", {
    access: "write",
    description:
      "Create a CRM account (organization, customer, partner, or competitor).",
    inputSchema: t.Object(
      {
        name: t.String({
          minLength: 1,
          maxLength: 300,
          pattern: "\\S",
          description: "Account name",
        }),
        domain: t.Optional(
          t.String({ minLength: 1, maxLength: 300, pattern: "\\S" }),
        ),
        accountType: t.Optional(
          t.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
        ),
        lifecycleStage: t.Optional(
          t.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
        ),
        ...createRecordFields(),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ account: CrmAccount }>(
        ctx,
        `${CRM_BASE}/accounts`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.account;
    },
  });

  rl.registerAction("account.update", {
    access: "write",
    description:
      "Update or archive a CRM account. Omitted fields are preserved; null clears a nullable field.",
    inputSchema: t.Object(
      {
        id: idSchema("Account record ID"),
        name: t.Optional(
          t.String({ minLength: 1, maxLength: 300, pattern: "\\S" }),
        ),
        domain: nullableString(300, "Primary web domain"),
        accountType: nullableString(100, "Account type"),
        lifecycleStage: nullableString(100, "Lifecycle stage"),
        ...updateRecordFields(),
      },
      STRICT_UPDATE_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...patch } = input as { id: string } & Record<
        string,
        unknown
      >;
      const body = await request<{ account: CrmAccount }>(
        ctx,
        `${CRM_BASE}/accounts/${pathSegment(id)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      return body.account;
    },
  });
}
