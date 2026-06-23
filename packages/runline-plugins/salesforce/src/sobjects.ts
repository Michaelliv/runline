import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { records, type QueryResult } from "./queryResult.js";
import { api, type Ctx } from "./shared.js";

export const SOBJECTS = [
  "Account",
  "Contact",
  "Lead",
  "Opportunity",
  "Case",
  "Task",
  "User",
] as const;

export const DEFAULT_FIELDS: Record<string, string> = {
  Account: "Id,Name,Type",
  Contact: "Id,FirstName,LastName,Email",
  Lead: "Id,Company,FirstName,LastName,Email,Status",
  Opportunity: "Id,AccountId,Amount,Probability,StageName",
  Case: "Id,AccountId,ContactId,Priority,Status,Subject",
  Task: "Id,Subject,Status,Priority",
  User: "Id,Name,Email",
};

const Data = t.Record(t.String(), t.Unknown(), {
  description: "Salesforce field values",
});

const QueryInput = (sObject: string) =>
  t.Object({
    fields: t.Optional(
      t.String({
        description: `Comma-separated fields (default: ${DEFAULT_FIELDS[sObject] ?? "Id"})`,
      }),
    ),
    where: t.Optional(t.String({ description: "SOQL WHERE clause" })),
    limit: t.Optional(t.Number({ description: "Max records" })),
  });

function buildQuery(
  sObject: string,
  input: unknown,
): string {
  const p = (input ?? {}) as { fields?: string; where?: string; limit?: number };
  const fields = p.fields || DEFAULT_FIELDS[sObject] || "Id";
  let q = `SELECT ${fields} FROM ${sObject}`;
  if (p.where) q += ` WHERE ${p.where}`;
  if (p.limit) q += ` LIMIT ${p.limit}`;
  return q;
}

function registerSObject(rl: RunlinePluginAPI, sObject: string) {
  const lower = sObject.toLowerCase();

  rl.registerAction(`${lower}.create`, {
    description: `Create a ${sObject}`,
    inputSchema: t.Object({ data: Data }),
    async execute(input, ctx) {
      return api(
        ctx as Ctx,
        "POST",
        `/sobjects/${sObject}`,
        (input as { data: Record<string, unknown> }).data,
      );
    },
  });

  rl.registerAction(`${lower}.get`, {
    description: `Get a ${sObject} by ID`,
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      return api(
        ctx as Ctx,
        "GET",
        `/sobjects/${sObject}/${(input as { id: string }).id}`,
      );
    },
  });

  rl.registerAction(`${lower}.update`, {
    description: `Update a ${sObject}`,
    inputSchema: t.Object({ id: t.String(), data: Data }),
    async execute(input, ctx) {
      const p = input as { id: string; data: Record<string, unknown> };
      await api(ctx as Ctx, "PATCH", `/sobjects/${sObject}/${p.id}`, p.data);
      return { success: true, id: p.id };
    },
  });

  rl.registerAction(`${lower}.delete`, {
    description: `Delete a ${sObject}`,
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      await api(
        ctx as Ctx,
        "DELETE",
        `/sobjects/${sObject}/${(input as { id: string }).id}`,
      );
      return { success: true };
    },
  });

  rl.registerAction(`${lower}.query`, {
    description: `Query ${sObject}s with SOQL`,
    inputSchema: QueryInput(sObject),
    async execute(input, ctx) {
      return records(
        await api(ctx as Ctx, "GET", "/query", undefined, {
          q: buildQuery(sObject, input),
        }),
      );
    },
  });

  rl.registerAction(`${lower}.queryPage`, {
    description: `Query ${sObject}s with SOQL and return Salesforce pagination metadata`,
    inputSchema: QueryInput(sObject),
    async execute(input, ctx) {
      return api(ctx as Ctx, "GET", "/query", undefined, {
        q: buildQuery(sObject, input),
      }) as Promise<QueryResult>;
    },
  });

  rl.registerAction(`${lower}.upsert`, {
    description: `Upsert a ${sObject} by external ID`,
    inputSchema: t.Object({
      externalIdField: t.String(),
      externalIdValue: t.String(),
      data: Data,
    }),
    async execute(input, ctx) {
      const p = input as {
        externalIdField: string;
        externalIdValue: string;
        data: Record<string, unknown>;
      };
      return api(
        ctx as Ctx,
        "PATCH",
        `/sobjects/${sObject}/${p.externalIdField}/${p.externalIdValue}`,
        p.data,
      );
    },
  });
}

export function registerStandardSObjectActions(rl: RunlinePluginAPI) {
  for (const sObject of SOBJECTS) registerSObject(rl, sObject);
}

export function registerGenericSObjectActions(rl: RunlinePluginAPI) {
  rl.registerAction("sobject.create", {
    description: "Create any sObject record",
    inputSchema: t.Object({ sObject: t.String(), data: Data }),
    async execute(input, ctx) {
      const p = input as { sObject: string; data: Record<string, unknown> };
      return api(ctx as Ctx, "POST", `/sobjects/${p.sObject}`, p.data);
    },
  });

  rl.registerAction("sobject.get", {
    description: "Get any sObject record",
    inputSchema: t.Object({ sObject: t.String(), id: t.String() }),
    async execute(input, ctx) {
      const p = input as { sObject: string; id: string };
      return api(ctx as Ctx, "GET", `/sobjects/${p.sObject}/${p.id}`);
    },
  });

  rl.registerAction("sobject.update", {
    description: "Update any sObject record",
    inputSchema: t.Object({ sObject: t.String(), id: t.String(), data: Data }),
    async execute(input, ctx) {
      const p = input as {
        sObject: string;
        id: string;
        data: Record<string, unknown>;
      };
      await api(ctx as Ctx, "PATCH", `/sobjects/${p.sObject}/${p.id}`, p.data);
      return { success: true };
    },
  });

  rl.registerAction("sobject.delete", {
    description: "Delete any sObject record",
    inputSchema: t.Object({ sObject: t.String(), id: t.String() }),
    async execute(input, ctx) {
      const p = input as { sObject: string; id: string };
      await api(ctx as Ctx, "DELETE", `/sobjects/${p.sObject}/${p.id}`);
      return { success: true };
    },
  });

  rl.registerAction("sobject.describe", {
    description: "Describe an sObject's metadata/fields",
    inputSchema: t.Object({ sObject: t.String() }),
    async execute(input, ctx) {
      return api(
        ctx as Ctx,
        "GET",
        `/sobjects/${(input as { sObject: string }).sObject}/describe`,
      );
    },
  });
}
