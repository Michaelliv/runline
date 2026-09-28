import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { gotowebinarCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: unknown,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, gotowebinarCredential, "gotowebinar", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body !== undefined && method !== "GET" && method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

function getConn(ctx: ActionContext) {
  return {
    organizerKey: ctx.connection.config.organizerKey as string,
  };
}

export default function gotowebinar(rl: RunlinePluginAPI) {
  rl.setName("gotowebinar");
  rl.setVersion("0.1.0");
  rl.setCredential(gotowebinarCredential);

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
      const { organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = { subject, times };
      if (desc) body.description = desc;
      if (timeZone) body.timeZone = timeZone;
      if (type) body.type = type;
      if (isPasswordProtected !== undefined)
        body.isPasswordProtected = isPasswordProtected;
      return apiRequest(
        ctx,
        "POST",
        `organizers/${seg(organizerKey)}/webinars`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg((input as { webinarKey: string }).webinarKey)}`,
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
      const { organizerKey } = getConn(ctx);
      const data = (await apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars`,
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
      const { organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = {};
      if (subject) body.subject = subject;
      if (desc) body.description = desc;
      if (times) body.times = times;
      if (timeZone) body.timeZone = timeZone;
      return apiRequest(
        ctx,
        "PUT",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}`,
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
      const { organizerKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (sendCancellationEmails !== undefined)
        qs.sendCancellationEmails = sendCancellationEmails;
      await apiRequest(
        ctx,
        "DELETE",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "POST",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/registrants`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/registrants/${seg(registrantKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg((input as { webinarKey: string }).webinarKey)}/registrants`,
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
      const { organizerKey } = getConn(ctx);
      await apiRequest(
        ctx,
        "DELETE",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/registrants/${seg(registrantKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/sessions/${seg(sessionKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg((input as { webinarKey: string }).webinarKey)}/sessions`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/sessions/${seg(sessionKey)}/performance`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/sessions/${seg(sessionKey)}/attendees/${seg(registrantKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/sessions/${seg(sessionKey)}/attendees`,
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
      const { organizerKey } = getConn(ctx);
      const body: Record<string, unknown> = { external };
      if (coorgKey) body.organizerKey = coorgKey;
      if (givenName) body.givenName = givenName;
      if (email) body.email = email;
      return apiRequest(
        ctx,
        "POST",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/coorganizers`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg((input as { webinarKey: string }).webinarKey)}/coorganizers`,
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
      const { organizerKey } = getConn(ctx);
      const qs: Record<string, unknown> = {};
      if (external !== undefined) qs.external = external;
      await apiRequest(
        ctx,
        "DELETE",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/coorganizers/${seg(coorganizerKey)}`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "POST",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/panelists`,
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
      const { organizerKey } = getConn(ctx);
      return apiRequest(
        ctx,
        "GET",
        `organizers/${seg(organizerKey)}/webinars/${seg((input as { webinarKey: string }).webinarKey)}/panelists`,
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
      const { organizerKey } = getConn(ctx);
      await apiRequest(
        ctx,
        "DELETE",
        `organizers/${seg(organizerKey)}/webinars/${seg(webinarKey)}/panelists/${seg(panelistKey)}`,
      );
      return { success: true };
    },
  });
}
