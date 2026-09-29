import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { chargebeeCredential } from "./credentials.js";

/** Chargebee takes write parameters as query-string params, never a body. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, chargebeeCredential, "chargebee", {
    target: "api",
    path,
    method,
    query: qs,
  });
}

export default function chargebee(rl: RunlinePluginAPI) {
  rl.setName("chargebee");
  rl.setVersion("0.1.0");
  rl.setCredential(chargebeeCredential);

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
      const params = (input ?? {}) as Record<string, unknown>;
      return apiRequest(ctx, "POST", "customers", params);
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
    },
    async execute(input, ctx) {
      const { limit = 10 } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        limit,
        "sort_by[desc]": "date",
      };
      const data = (await apiRequest(ctx, "GET", "invoices", qs)) as Record<
        string,
        unknown
      >;
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
      const data = (await apiRequest(
        ctx,
        "POST",
        `invoices/${pathSegment(invoiceId.trim())}/pdf`,
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
      const qs: Record<string, unknown> = {};
      if (endOfTerm) qs.end_of_term = "true";
      return apiRequest(
        ctx,
        "POST",
        `subscriptions/${pathSegment(subscriptionId.trim())}/cancel`,
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
      return apiRequest(
        ctx,
        "POST",
        `subscriptions/${pathSegment(subscriptionId.trim())}/delete`,
      );
    },
  });
}
