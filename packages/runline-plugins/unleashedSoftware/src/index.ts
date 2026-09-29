import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { unleashedSoftwareCredential } from "./credentials.js";

/** An Unleashed read; Unleashed asks for a JSON Content-Type even on GET. */
function apiRequest(
  ctx: ActionContext,
  path: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, unleashedSoftwareCredential, "unleashedSoftware", {
    target: "api",
    path,
    query,
    headers: { "Content-Type": "application/json" },
  });
}

export default function unleashedSoftware(rl: RunlinePluginAPI) {
  rl.setName("unleashedSoftware");
  rl.setVersion("0.1.0");
  rl.setCredential(unleashedSoftwareCredential);
  rl.setConnectionSchema({
    apiId: {
      type: "string",
      required: true,
      description: "Unleashed API ID",
      env: "UNLEASHED_API_ID",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Unleashed API Key",
      env: "UNLEASHED_API_KEY",
    },
  });

  rl.registerAction("salesOrder.list", {
    access: "read",
    description: "List sales orders",
    inputSchema: {
      limit: { type: "number", required: false },
      startDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      endDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      orderStatus: {
        type: "string",
        required: false,
        description: "Comma-separated statuses",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.startDate) qs.startDate = p.startDate;
      if (p.endDate) qs.endDate = p.endDate;
      if (p.orderStatus) qs.orderStatus = p.orderStatus;
      if (p.limit) qs.pageSize = p.limit;
      const data = (await apiRequest(ctx, "SalesOrders/1", qs)) as Record<
        string,
        unknown
      >;
      return data.Items;
    },
  });

  rl.registerAction("stockOnHand.list", {
    access: "read",
    description: "List stock on hand",
    inputSchema: {
      limit: { type: "number", required: false },
      asAtDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      productCode: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.asAtDate) qs.asAtDate = p.asAtDate;
      if (p.productCode) qs.productCode = p.productCode;
      if (p.limit) qs.pageSize = p.limit;
      const data = (await apiRequest(ctx, "StockOnHand/1", qs)) as Record<
        string,
        unknown
      >;
      return data.Items;
    },
  });

  rl.registerAction("stockOnHand.get", {
    access: "read",
    description: "Get stock on hand for a product",
    inputSchema: { productId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        `StockOnHand/${pathSegment((input as Record<string, unknown>).productId)}`,
      );
    },
  });
}
