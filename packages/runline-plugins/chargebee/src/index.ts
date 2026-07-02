import type { RunlinePluginAPI } from "runline";

function buildBaseUrl(accountName: string): string {
  return `https://${accountName}.chargebee.com/api/v2`;
}

async function apiRequest(
  accountName: string,
  apiKey: string,
  method: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${buildBaseUrl(accountName)}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };

  const res = await fetch(url.toString(), opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chargebee API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    accountName: ctx.connection.config.accountName as string,
    apiKey: ctx.connection.config.apiKey as string,
  };
}

export default function chargebee(rl: RunlinePluginAPI) {
  rl.setName("chargebee");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accountName: {
      type: "string",
      required: true,
      description: "Chargebee account/site name",
      env: "CHARGEBEE_ACCOUNT_NAME",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "Chargebee API key",
      env: "CHARGEBEE_API_KEY",
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.create", {
    access: "write",
    description: "Create a customer",
    inputSchema: {
      id: {
        type: "string",
        required: false,
        description: "Customer ID (auto-generated if omitted)",
      },
      first_name: {
        type: "string",
        required: false,
        description: "First name",
      },
      last_name: { type: "string", required: false, description: "Last name" },
      email: { type: "string", required: false, description: "Email" },
      phone: { type: "string", required: false, description: "Phone" },
      company: { type: "string", required: false, description: "Company" },
    },
    async execute(input, ctx) {
      const { accountName, apiKey } = getConn(ctx);
      const params = (input ?? {}) as Record<string, unknown>;
      // Chargebee uses form-encoded POST params via query string
      return apiRequest(accountName, apiKey, "POST", "customers", params);
    },
  });

  // ── Invoice ─────────────────────────────────────────

  rl.registerAction("invoice.list", {
    access: "read",
    description: "List invoices",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default: 10, max: 100)",
      },
      sortBy: {
        type: "string",
        required: false,
        description: "Sort field (default: date desc)",
      },
    },
    async execute(input, ctx) {
      const { accountName, apiKey } = getConn(ctx);
      const { limit = 10 } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        limit,
        "sort_by[desc]": "date",
      };
      const data = (await apiRequest(
        accountName,
        apiKey,
        "GET",
        "invoices",
        qs,
      )) as Record<string, unknown>;
      const list = (data.list as Array<Record<string, unknown>>) ?? [];
      return list.map((item) => item.invoice);
    },
  });

  rl.registerAction("invoice.getPdfUrl", {
    access: "write",
    description: "Get the PDF download URL for an invoice",
    inputSchema: {
      invoiceId: { type: "string", required: true, description: "Invoice ID" },
    },
    async execute(input, ctx) {
      const { invoiceId } = input as { invoiceId: string };
      const { accountName, apiKey } = getConn(ctx);
      const data = (await apiRequest(
        accountName,
        apiKey,
        "POST",
        `invoices/${invoiceId.trim()}/pdf`,
      )) as Record<string, unknown>;
      const download = data.download as Record<string, unknown>;
      return { pdfUrl: download?.download_url };
    },
  });

  // ── Subscription ────────────────────────────────────

  rl.registerAction("subscription.cancel", {
    access: "write",
    description: "Cancel a subscription",
    inputSchema: {
      subscriptionId: {
        type: "string",
        required: true,
        description: "Subscription ID",
      },
      endOfTerm: {
        type: "boolean",
        required: false,
        description:
          "Schedule cancellation at end of term instead of immediate",
      },
    },
    async execute(input, ctx) {
      const { subscriptionId, endOfTerm } = input as {
        subscriptionId: string;
        endOfTerm?: boolean;
      };
      const { accountName, apiKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (endOfTerm) qs.end_of_term = "true";
      return apiRequest(
        accountName,
        apiKey,
        "POST",
        `subscriptions/${subscriptionId.trim()}/cancel`,
        qs,
      );
    },
  });

  rl.registerAction("subscription.delete", {
    access: "write",
    description: "Delete a subscription",
    inputSchema: {
      subscriptionId: {
        type: "string",
        required: true,
        description: "Subscription ID",
      },
    },
    async execute(input, ctx) {
      const { subscriptionId } = input as { subscriptionId: string };
      const { accountName, apiKey } = getConn(ctx);
      return apiRequest(
        accountName,
        apiKey,
        "POST",
        `subscriptions/${subscriptionId.trim()}/delete`,
      );
    },
  });
}
