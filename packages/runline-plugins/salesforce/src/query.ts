import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { type QueryResult, records } from "./queryResult.js";
import { api, type Ctx, rest } from "./shared.js";

const QueryInput = t.Object({
  query: t.String({ description: "Full SOQL query" }),
});

async function queryPage(
  ctx: Ctx,
  endpoint: "/query" | "/queryAll",
  query: string,
): Promise<QueryResult> {
  return (await api(ctx, "GET", endpoint, undefined, {
    q: query,
  })) as QueryResult;
}

export function registerQueryActions(rl: RunlinePluginAPI) {
  rl.registerAction("soql.query", {
    description:
      "Execute a raw SOQL query and return the first page of records",
    inputSchema: QueryInput,
    async execute(input, ctx) {
      return records(
        await queryPage(
          ctx as Ctx,
          "/query",
          (input as { query: string }).query,
        ),
      );
    },
  });

  rl.registerAction("soql.queryPage", {
    description:
      "Execute a raw SOQL query and return Salesforce pagination metadata",
    inputSchema: QueryInput,
    async execute(input, ctx) {
      return queryPage(
        ctx as Ctx,
        "/query",
        (input as { query: string }).query,
      );
    },
  });

  rl.registerAction("soql.queryAll", {
    description:
      "Execute a raw SOQL query including deleted and archived records; returns the first page of records",
    inputSchema: QueryInput,
    async execute(input, ctx) {
      return records(
        await queryPage(
          ctx as Ctx,
          "/queryAll",
          (input as { query: string }).query,
        ),
      );
    },
  });

  rl.registerAction("soql.queryAllPage", {
    description:
      "Execute a raw SOQL query including deleted and archived records and return Salesforce pagination metadata",
    inputSchema: QueryInput,
    async execute(input, ctx) {
      return queryPage(
        ctx as Ctx,
        "/queryAll",
        (input as { query: string }).query,
      );
    },
  });

  rl.registerAction("soql.nextPage", {
    description:
      "Fetch the next page from a Salesforce nextRecordsUrl returned by soql.queryPage or soql.queryAllPage",
    inputSchema: t.Object({
      nextRecordsUrl: t.String({
        description:
          "Salesforce nextRecordsUrl, e.g. /services/data/v59.0/query/01g...",
      }),
    }),
    async execute(input, ctx) {
      return rest(
        ctx as Ctx,
        "GET",
        (input as { nextRecordsUrl: string }).nextRecordsUrl,
      ) as Promise<QueryResult>;
    },
  });
}
