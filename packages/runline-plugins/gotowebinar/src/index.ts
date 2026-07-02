import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.getgo.com/G2W/rest/v2";

async function apiRequest(
  accessToken: string,
  method: string,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`GoToWebinar API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  return { success: true };
}

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    accessToken: ctx.connection.config.accessToken as string,
    organizerKey: ctx.connection.config.organizerKey as string,
  };
}

export default function gotowebinar(rl: RunlinePluginAPI) {
  rl.setName("gotowebinar");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "GoTo OAuth2 access token",
      env: "GOTO_ACCESS_TOKEN",
    },
    organizerKey: {
      type: "string",
      required: true,
      description: "Organizer key",
      env: "GOTO_ORGANIZER_KEY",
    },
  });

  // ── Webinar ─────────────────────────────────────────

  rl.registerAction("webinar.create", {
    access: "write",
    description: "Create a webinar",
    inputSchema: {
      subject: {
        type: "string",
        required: true,
        description: "Webinar subject",
      },
      times: {
        type: "array",
        required: true,
        description: "Array of {startTime, endTime} (ISO 8601)",
      },
      description: {
        type: "string",
        required: false,
        description: "Description",
      },
      timeZone: { type: "string", required: false, description: "Time zone" },
      type: {
        type: "string",
        required: false,
        description: "single_session, series, sequence",
      },
      isPasswordProtected: {
        type: "boolean",
        required: false,
        description: "Require password",
      },
    },
    async execute(input, ctx) {
      const {
        subject,
        times,
        description: desc,
        timeZone,
        type,
        isPasswordProtected,
      } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = { subject, times };
      if (desc) body.description = desc;
      if (timeZone) body.timeZone = timeZone;
      if (type) body.type = type;
      if (isPasswordProtected !== undefined)
        body.isPasswordProtected = isPasswordProtected;
      return apiRequest(
        accessToken,
        "POST",
        `organizers/${organizerKey}/webinars`,
        body,
      );
    },
  });

  rl.registerAction("webinar.get", {
    access: "read",
    description: "Get a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${(input as { webinarKey: string }).webinarKey}`,
      );
    },
  });

  rl.registerAction("webinar.list", {
    access: "read",
    description: "List webinars",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      const data = (await apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars`,
      )) as Record<string, unknown>;
      const list =
        (data._embedded as Record<string, unknown>)?.webinars ?? data;
      if ((input as Record<string, unknown>)?.limit && Array.isArray(list))
        return (list as unknown[]).slice(0, (input as { limit: number }).limit);
      return list;
    },
  });

  rl.registerAction("webinar.update", {
    access: "write",
    description: "Update a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      subject: { type: "string", required: false, description: "New subject" },
      description: {
        type: "string",
        required: false,
        description: "New description",
      },
      times: { type: "array", required: false, description: "New times" },
      timeZone: {
        type: "string",
        required: false,
        description: "New time zone",
      },
    },
    async execute(input, ctx) {
      const {
        webinarKey,
        subject,
        description: desc,
        times,
        timeZone,
      } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = {};
      if (subject) body.subject = subject;
      if (desc) body.description = desc;
      if (times) body.times = times;
      if (timeZone) body.timeZone = timeZone;
      return apiRequest(
        accessToken,
        "PUT",
        `organizers/${organizerKey}/webinars/${webinarKey}`,
        body,
      );
    },
  });

  rl.registerAction("webinar.delete", {
    access: "write",
    description: "Delete a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      sendCancellationEmails: {
        type: "boolean",
        required: false,
        description: "Send cancellation emails",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, sendCancellationEmails } = input as Record<
        string,
        unknown
      >;
      const { accessToken, organizerKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (sendCancellationEmails !== undefined)
        qs.sendCancellationEmails = sendCancellationEmails;
      await apiRequest(
        accessToken,
        "DELETE",
        `organizers/${organizerKey}/webinars/${webinarKey}`,
        undefined,
        qs,
      );
      return { success: true };
    },
  });

  // ── Registrant ──────────────────────────────────────

  rl.registerAction("registrant.create", {
    access: "write",
    description: "Register a person for a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: true, description: "Last name" },
      email: { type: "string", required: true, description: "Email" },
    },
    async execute(input, ctx) {
      const { webinarKey, firstName, lastName, email } = input as Record<
        string,
        unknown
      >;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "POST",
        `organizers/${organizerKey}/webinars/${webinarKey}/registrants`,
        { firstName, lastName, email },
      );
    },
  });

  rl.registerAction("registrant.get", {
    access: "read",
    description: "Get a registrant",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      registrantKey: {
        type: "string",
        required: true,
        description: "Registrant key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, registrantKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${webinarKey}/registrants/${registrantKey}`,
      );
    },
  });

  rl.registerAction("registrant.list", {
    access: "read",
    description: "List registrants for a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${(input as { webinarKey: string }).webinarKey}/registrants`,
      );
    },
  });

  rl.registerAction("registrant.delete", {
    access: "write",
    description: "Delete a registrant",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      registrantKey: {
        type: "string",
        required: true,
        description: "Registrant key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, registrantKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      await apiRequest(
        accessToken,
        "DELETE",
        `organizers/${organizerKey}/webinars/${webinarKey}/registrants/${registrantKey}`,
      );
      return { success: true };
    },
  });

  // ── Session ─────────────────────────────────────────

  rl.registerAction("session.get", {
    access: "read",
    description: "Get a session",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      sessionKey: {
        type: "string",
        required: true,
        description: "Session key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, sessionKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${webinarKey}/sessions/${sessionKey}`,
      );
    },
  });

  rl.registerAction("session.list", {
    access: "read",
    description: "List sessions for a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${(input as { webinarKey: string }).webinarKey}/sessions`,
      );
    },
  });

  rl.registerAction("session.getPerformance", {
    access: "read",
    description: "Get session performance details",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      sessionKey: {
        type: "string",
        required: true,
        description: "Session key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, sessionKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${webinarKey}/sessions/${sessionKey}/performance`,
      );
    },
  });

  // ── Attendee ────────────────────────────────────────

  rl.registerAction("attendee.get", {
    access: "read",
    description: "Get an attendee",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      sessionKey: {
        type: "string",
        required: true,
        description: "Session key",
      },
      registrantKey: {
        type: "string",
        required: true,
        description: "Registrant key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, sessionKey, registrantKey } = input as Record<
        string,
        unknown
      >;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${webinarKey}/sessions/${sessionKey}/attendees/${registrantKey}`,
      );
    },
  });

  rl.registerAction("attendee.list", {
    access: "read",
    description: "List attendees for a session",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      sessionKey: {
        type: "string",
        required: true,
        description: "Session key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, sessionKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${webinarKey}/sessions/${sessionKey}/attendees`,
      );
    },
  });

  // ── Coorganizer ─────────────────────────────────────

  rl.registerAction("coorganizer.create", {
    access: "write",
    description: "Add a co-organizer to a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      external: {
        type: "boolean",
        required: true,
        description: "true for external, false for internal",
      },
      organizerKey: {
        type: "string",
        required: false,
        description: "Organizer key (internal)",
      },
      givenName: {
        type: "string",
        required: false,
        description: "First name (external)",
      },
      email: {
        type: "string",
        required: false,
        description: "Email (external)",
      },
    },
    async execute(input, ctx) {
      const {
        webinarKey,
        external,
        organizerKey: coorgKey,
        givenName,
        email,
      } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = { external };
      if (coorgKey) body.organizerKey = coorgKey;
      if (givenName) body.givenName = givenName;
      if (email) body.email = email;
      return apiRequest(
        accessToken,
        "POST",
        `organizers/${organizerKey}/webinars/${webinarKey}/coorganizers`,
        [body],
      );
    },
  });

  rl.registerAction("coorganizer.list", {
    access: "read",
    description: "List co-organizers",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${(input as { webinarKey: string }).webinarKey}/coorganizers`,
      );
    },
  });

  rl.registerAction("coorganizer.delete", {
    access: "write",
    description: "Remove a co-organizer",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      coorganizerKey: {
        type: "string",
        required: true,
        description: "Co-organizer key",
      },
      external: {
        type: "boolean",
        required: false,
        description: "Whether external",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, coorganizerKey, external } = input as Record<
        string,
        unknown
      >;
      const { accessToken, organizerKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (external !== undefined) qs.external = external;
      await apiRequest(
        accessToken,
        "DELETE",
        `organizers/${organizerKey}/webinars/${webinarKey}/coorganizers/${coorganizerKey}`,
        undefined,
        qs,
      );
      return { success: true };
    },
  });

  // ── Panelist ────────────────────────────────────────

  rl.registerAction("panelist.create", {
    access: "write",
    description: "Add a panelist to a webinar",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      name: { type: "string", required: true, description: "Panelist name" },
      email: { type: "string", required: true, description: "Panelist email" },
    },
    async execute(input, ctx) {
      const { webinarKey, name, email } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "POST",
        `organizers/${organizerKey}/webinars/${webinarKey}/panelists`,
        [{ name, email }],
      );
    },
  });

  rl.registerAction("panelist.list", {
    access: "read",
    description: "List panelists",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
    },
    async execute(input, ctx) {
      const { accessToken, organizerKey } = getConn(ctx);
      return apiRequest(
        accessToken,
        "GET",
        `organizers/${organizerKey}/webinars/${(input as { webinarKey: string }).webinarKey}/panelists`,
      );
    },
  });

  rl.registerAction("panelist.delete", {
    access: "write",
    description: "Remove a panelist",
    inputSchema: {
      webinarKey: {
        type: "string",
        required: true,
        description: "Webinar key",
      },
      panelistKey: {
        type: "string",
        required: true,
        description: "Panelist key",
      },
    },
    async execute(input, ctx) {
      const { webinarKey, panelistKey } = input as Record<string, unknown>;
      const { accessToken, organizerKey } = getConn(ctx);
      await apiRequest(
        accessToken,
        "DELETE",
        `organizers/${organizerKey}/webinars/${webinarKey}/panelists/${panelistKey}`,
      );
      return { success: true };
    },
  });
}
