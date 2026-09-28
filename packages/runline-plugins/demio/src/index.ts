import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { demioCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, demioCredential, "demio", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function demio(rl: RunlinePluginAPI) {
  rl.setName("demio");
  rl.setVersion("0.1.0");
  rl.setCredential(demioCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Demio API key",
      env: "DEMIO_API_KEY",
    },
    apiSecret: {
      type: "string",
      required: true,
      description: "Demio API secret",
      env: "DEMIO_API_SECRET",
    },
  });

  rl.registerAction("event.get", {
    access: "read",
    description: "Get an event (optionally a specific session/date)",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      dateId: {
        type: "string",
        required: false,
        description: "Date/session ID (for specific session)",
      },
    },
    async execute(input, ctx) {
      const { eventId, dateId } = input as { eventId: string; dateId?: string };
      if (dateId) {
        return apiRequest(
          ctx,
          "GET",
          `event/${pathSegment(eventId)}/date/${pathSegment(dateId)}`,
        );
      }
      return apiRequest(ctx, "GET", `event/${pathSegment(eventId)}`);
    },
  });

  rl.registerAction("event.list", {
    access: "read",
    description: "List events",
    inputSchema: {
      type: {
        type: "string",
        required: false,
        description: "Filter: upcoming, past, all",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { type, limit } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      const data = (await apiRequest(
        ctx,
        "GET",
        "events",
        undefined,
        qs,
      )) as unknown[];
      if (limit) return data.slice(0, limit as number);
      return data;
    },
  });

  rl.registerAction("event.register", {
    access: "write",
    description: "Register a person for an event",
    inputSchema: {
      eventId: { type: "string", required: true, description: "Event ID" },
      email: {
        type: "string",
        required: true,
        description: "Registrant email",
      },
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      dateId: {
        type: "string",
        required: false,
        description: "Specific session date ID",
      },
      customFields: {
        type: "object",
        required: false,
        description: "Custom field key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { eventId, email, firstName, lastName, dateId, customFields } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        id: eventId,
        email,
        name: firstName,
      };
      if (lastName) body.last_name = lastName;
      if (dateId) body.date_id = dateId;
      if (customFields) Object.assign(body, customFields);
      return apiRequest(ctx, "PUT", "event/register", body);
    },
  });

  rl.registerAction("report.getParticipants", {
    access: "read",
    description: "Get participants report for a session",
    inputSchema: {
      dateId: {
        type: "string",
        required: true,
        description: "Session/date ID",
      },
      status: {
        type: "string",
        required: false,
        description: "Filter: attended, did-not-attend, banned, left-early",
      },
    },
    async execute(input, ctx) {
      const { dateId, status } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (status) qs.status = status;
      const data = (await apiRequest(
        ctx,
        "GET",
        `report/${pathSegment(dateId)}/participants`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.participants;
    },
  });
}
