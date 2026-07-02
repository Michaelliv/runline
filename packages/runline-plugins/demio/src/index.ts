import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://my.demio.com/api/v1";

async function apiRequest(
  apiKey: string,
  apiSecret: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      "Api-Secret": apiSecret,
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  ) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`Demio API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    apiKey: ctx.connection.config.apiKey as string,
    apiSecret: ctx.connection.config.apiSecret as string,
  };
}

export default function demio(rl: RunlinePluginAPI) {
  rl.setName("demio");
  rl.setVersion("0.1.0");

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
      const { apiKey, apiSecret } = getConn(ctx);
      if (dateId) {
        return apiRequest(
          apiKey,
          apiSecret,
          "GET",
          `/event/${eventId}/date/${dateId}`,
        );
      }
      return apiRequest(apiKey, apiSecret, "GET", `/event/${eventId}`);
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
      const { apiKey, apiSecret } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (type) qs.type = type;
      const data = (await apiRequest(
        apiKey,
        apiSecret,
        "GET",
        "/events",
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
      const { apiKey, apiSecret } = getConn(ctx);
      const body: Record<string, unknown> = {
        id: eventId,
        email,
        name: firstName,
      };
      if (lastName) body.last_name = lastName;
      if (dateId) body.date_id = dateId;
      if (customFields) Object.assign(body, customFields);
      return apiRequest(apiKey, apiSecret, "PUT", "/event/register", body);
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
      const { apiKey, apiSecret } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (status) qs.status = status;
      const data = (await apiRequest(
        apiKey,
        apiSecret,
        "GET",
        `/report/${dateId}/participants`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.participants;
    },
  });
}
