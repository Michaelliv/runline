import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialOk,
  jsonOrAcknowledged,
  pathSegment,
} from "../../_shared/credentials.js";
import { customerIoCredential } from "./credentials.js";

/** A Customer.io call on the Track or App API. */
async function apiRequest(
  ctx: ActionContext,
  target: "track" | "app",
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const res = await credentialOk(ctx, customerIoCredential, "customerIo", {
    target,
    path,
    method,
    query,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
  return jsonOrAcknowledged(res);
}

export default function customerIo(rl: RunlinePluginAPI) {
  rl.setName("customerIo");
  rl.setVersion("0.1.0");
  rl.setCredential(customerIoCredential);

  rl.setConnectionSchema({
    siteId: {
      type: "string",
      required: true,
      description: "Customer.io Site ID",
      env: "CUSTOMERIO_SITE_ID",
    },
    trackingApiKey: {
      type: "string",
      required: true,
      description: "Tracking API key",
      env: "CUSTOMERIO_TRACKING_API_KEY",
    },
    appApiKey: {
      type: "string",
      required: true,
      description: "App API key (for campaigns)",
      env: "CUSTOMERIO_APP_API_KEY",
    },
    region: {
      type: "string",
      required: false,
      description:
        "Region: track.customer.io (US, default) or track-eu.customer.io (EU)",
      default: "track.customer.io",
    },
  });

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.get", {
    access: "read",
    description: "Get a campaign by ID",
    inputSchema: {
      campaignId: {
        type: "number",
        required: true,
        description: "Campaign ID",
      },
    },
    async execute(input, ctx) {
      const { campaignId } = input as { campaignId: number };
      const data = (await apiRequest(
        ctx,
        "app",
        "GET",
        `campaigns/${pathSegment(campaignId)}`,
      )) as Record<string, unknown>;
      return data.campaign;
    },
  });

  rl.registerAction("campaign.list", {
    access: "read",
    description: "List all campaigns",
    async execute(_input, ctx) {
      const data = (await apiRequest(ctx, "app", "GET", "campaigns")) as Record<
        string,
        unknown
      >;
      return data.campaigns;
    },
  });

  rl.registerAction("campaign.getMetrics", {
    access: "read",
    description: "Get campaign metrics",
    inputSchema: {
      campaignId: {
        type: "number",
        required: true,
        description: "Campaign ID",
      },
      period: {
        type: "string",
        required: false,
        description: "Period: days (default), weeks, months",
      },
      steps: {
        type: "number",
        required: false,
        description: "Number of steps/periods",
      },
      type: {
        type: "string",
        required: false,
        description: "Metric type: email, webhook, push, slack, urbanAirship",
      },
    },
    async execute(input, ctx) {
      const { campaignId, period, steps, type } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const query: Record<string, unknown> = {};
      if (period && period !== "days") query.period = period;
      if (steps) query.steps = steps;
      if (type) query.type = type === "urbanAirship" ? "urban_airship" : type;
      const data = (await apiRequest(
        ctx,
        "app",
        "GET",
        `campaigns/${pathSegment(campaignId)}/metrics`,
        undefined,
        query,
      )) as Record<string, unknown>;
      return data.metric;
    },
  });

  // ── Customer ────────────────────────────────────────

  rl.registerAction("customer.upsert", {
    access: "write",
    description: "Create or update a customer",
    inputSchema: {
      id: {
        type: "string",
        required: true,
        description: "Customer ID (your internal ID)",
      },
      email: { type: "string", required: false, description: "Email address" },
      createdAt: {
        type: "string",
        required: false,
        description: "Created at (ISO 8601)",
      },
      attributes: {
        type: "object",
        required: false,
        description: "Custom attributes as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { id, email, createdAt, attributes } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (email) body.email = email;
      if (createdAt)
        body.created_at = Math.floor(
          new Date(createdAt as string).getTime() / 1000,
        );
      if (attributes) body.data = attributes;
      await apiRequest(
        ctx,
        "track",
        "PUT",
        `customers/${pathSegment(id)}`,
        body,
      );
      return { id, ...body };
    },
  });

  rl.registerAction("customer.delete", {
    access: "write",
    description: "Delete a customer",
    inputSchema: {
      id: { type: "string", required: true, description: "Customer ID" },
    },
    async execute(input, ctx) {
      const { id } = input as { id: string };
      await apiRequest(ctx, "track", "DELETE", `customers/${pathSegment(id)}`);
      return { success: true };
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.track", {
    access: "write",
    description: "Track an event for a customer",
    inputSchema: {
      customerId: {
        type: "string",
        required: true,
        description: "Customer ID",
      },
      eventName: { type: "string", required: true, description: "Event name" },
      type: {
        type: "string",
        required: false,
        description: "Event type (e.g. page)",
      },
      data: {
        type: "object",
        required: false,
        description: "Custom event attributes",
      },
    },
    async execute(input, ctx) {
      const { customerId, eventName, type, data } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name: eventName };
      const eventData: Record<string, unknown> = {};
      if (type) eventData.type = type;
      if (data) Object.assign(eventData, data);
      if (Object.keys(eventData).length > 0) body.data = eventData;
      await apiRequest(
        ctx,
        "track",
        "POST",
        `customers/${pathSegment(customerId)}/events`,
        body,
      );
      return { success: true };
    },
  });

  rl.registerAction("event.trackAnonymous", {
    access: "write",
    description: "Track an anonymous event (not tied to a customer)",
    inputSchema: {
      eventName: { type: "string", required: true, description: "Event name" },
      data: {
        type: "object",
        required: false,
        description: "Custom event attributes",
      },
    },
    async execute(input, ctx) {
      const { eventName, data } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name: eventName };
      if (data) body.data = data;
      await apiRequest(ctx, "track", "POST", "events", body);
      return { success: true };
    },
  });

  // ── Segment ─────────────────────────────────────────

  rl.registerAction("segment.addCustomers", {
    access: "write",
    description: "Add customers to a manual segment",
    inputSchema: {
      segmentId: { type: "number", required: true, description: "Segment ID" },
      customerIds: {
        type: "array",
        required: true,
        description: "Array of customer IDs",
      },
    },
    async execute(input, ctx) {
      const { segmentId, customerIds } = input as {
        segmentId: number;
        customerIds: string[];
      };
      await apiRequest(
        ctx,
        "track",
        "POST",
        `segments/${pathSegment(segmentId)}/add_customers`,
        {
          ids: customerIds,
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("segment.removeCustomers", {
    access: "write",
    description: "Remove customers from a manual segment",
    inputSchema: {
      segmentId: { type: "number", required: true, description: "Segment ID" },
      customerIds: {
        type: "array",
        required: true,
        description: "Array of customer IDs",
      },
    },
    async execute(input, ctx) {
      const { segmentId, customerIds } = input as {
        segmentId: number;
        customerIds: string[];
      };
      await apiRequest(
        ctx,
        "track",
        "POST",
        `segments/${pathSegment(segmentId)}/remove_customers`,
        {
          ids: customerIds,
        },
      );
      return { success: true };
    },
  });
}
