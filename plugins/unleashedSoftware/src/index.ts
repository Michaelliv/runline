import { createHmac } from "node:crypto";
import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.unleashedsoftware.com";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return { apiId: ctx.connection.config.apiId as string, apiKey: ctx.connection.config.apiKey as string };
}

function buildQs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

async function apiRequest(
  conn: { apiId: string; apiKey: string }, method: string, endpoint: string,
  qs?: Record<string, unknown>, page?: number,
): Promise<unknown> {
  const path = page ? `${endpoint}/${page}` : endpoint;
  const qsString = qs ? buildQs(qs) : "";
  const signature = createHmac("sha256", conn.apiKey).update(qsString).digest("base64");
  const url = qsString ? `${BASE}${path}?${qsString}` : `${BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "api-auth-id": conn.apiId, "api-auth-signature": signature },
  });
  if (!res.ok) throw new Error(`Unleashed error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function unleashedSoftware(rl: RunlinePluginAPI) {
  rl.setName("unleashedSoftware");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiId: { type: "string", required: true, description: "Unleashed API ID", env: "UNLEASHED_API_ID" },
    apiKey: { type: "string", required: true, description: "Unleashed API Key", env: "UNLEASHED_API_KEY" },
  });

  rl.registerAction("salesOrder.list", {
    description: "List sales orders",
    inputSchema: {
      limit: { type: "number", required: false },
      startDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      endDate: { type: "string", required: false, description: "YYYY-MM-DD" },
      orderStatus: { type: "string", required: false, description: "Comma-separated statuses" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.startDate) qs.startDate = p.startDate;
      if (p.endDate) qs.endDate = p.endDate;
      if (p.orderStatus) qs.orderStatus = p.orderStatus;
      if (p.limit) qs.pageSize = p.limit;
      const data = (await apiRequest(getConn(ctx), "GET", "/SalesOrders", qs, 1)) as Record<string, unknown>;
      return data.Items;
    },
  });

  rl.registerAction("stockOnHand.list", {
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
      const data = (await apiRequest(getConn(ctx), "GET", "/StockOnHand", qs, 1)) as Record<string, unknown>;
      return data.Items;
    },
  });

  rl.registerAction("stockOnHand.get", {
    description: "Get stock on hand for a product",
    inputSchema: { productId: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), "GET", `/StockOnHand/${(input as Record<string, unknown>).productId}`);
    },
  });
}
