/**
 * Microsoft Outlook calendar plugin for runline (Microsoft Graph).
 *
 * Auth: shared "microsoft" OAuth family (delegated → /me) or app-only
 * (tenantId/clientId/clientSecret + userUpn). See _shared/microsoftAuth.ts.
 * Graph delegated scopes: Calendars.Read for reads, Calendars.ReadWrite for
 * writes, Calendars.Read.Shared for findMeetingTimes. Each action asks only
 * for what it needs, so a connection consented before the write actions
 * existed keeps reading; the newer actions need a re-login.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import {
  graphRequest,
  microsoftCredential,
  microsoftSetupHelp,
  userBase,
} from "../../_shared/microsoftAuth.js";

const NAME = "microsoftCalendar";
const READ_SCOPES = ["https://graph.microsoft.com/Calendars.Read"];
const WRITE_SCOPES = [
  ...READ_SCOPES,
  "https://graph.microsoft.com/Calendars.ReadWrite",
];
const SHARED_SCOPES = ["https://graph.microsoft.com/Calendars.Read.Shared"];
const SCOPES = [...WRITE_SCOPES, ...SHARED_SCOPES];
type Ctx = ActionContext;

/** A Graph collection answer; items pass through to the caller unchanged. */
interface GraphList {
  value: unknown[];
}

/** Graph's dateTimeTimeZone: a wall-clock time and the zone it is read in. */
interface DateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}

/** The fields event.create and event.update compose a Graph event from. */
interface EventInput {
  subject?: string;
  start?: string;
  end?: string;
  timeZone?: string;
  allDay?: boolean;
  body?: string;
  html?: boolean;
  location?: string;
  attendees?: string[] | string;
  optionalAttendees?: string[] | string;
  isOnlineMeeting?: boolean;
  showAs?: string;
  importance?: string;
  sensitivity?: string;
  reminderMinutesBeforeStart?: number;
  categories?: string[];
  recurrence?: unknown;
}

const SELECT =
  "id,subject,start,end,location,organizer,attendees,isAllDay,webLink";
const RESPONSES = ["accept", "decline", "tentativelyAccept"] as const;

const list = (v: string[] | string | undefined) =>
  Array.isArray(v) ? v : v ? [v] : [];

const recipients = (v: string[] | string | undefined) =>
  list(v).map((address) => ({ emailAddress: { address } }));

/** An OData string literal: single quotes doubled. */
const literal = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * An ISO time with a zone (`Z` or an offset) is an instant and is sent in
 * UTC; one without is a wall-clock time read in `timeZone` (default UTC).
 * An all-day date is midnight of that date.
 */
function dateTime(
  value: string,
  timeZone: string | undefined,
  allDay: boolean,
): DateTimeTimeZone {
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error(`${NAME}: an all-day event takes YYYY-MM-DD dates`);
    return { dateTime: `${value}T00:00:00`, timeZone: timeZone ?? "UTC" };
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const instant = new Date(value);
    if (Number.isNaN(instant.getTime()))
      throw new Error(`${NAME}: invalid datetime ${value}`);
    return { dateTime: instant.toISOString().slice(0, -1), timeZone: "UTC" };
  }
  return { dateTime: value, timeZone: timeZone ?? "UTC" };
}

/** Only the fields supplied are set, so an update patches just those. */
function toEvent(p: EventInput): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  if (p.start !== undefined || p.end !== undefined) {
    if (p.start === undefined || p.end === undefined)
      throw new Error(`${NAME}: start and end must be given together`);
    const allDay = p.allDay === true;
    e.start = dateTime(p.start, p.timeZone, allDay);
    e.end = dateTime(p.end, p.timeZone, allDay);
    e.isAllDay = allDay;
  }
  if (p.subject !== undefined) e.subject = p.subject;
  if (p.body !== undefined)
    e.body = { contentType: p.html ? "HTML" : "Text", content: p.body };
  if (p.location !== undefined) e.location = { displayName: p.location };
  if (p.attendees !== undefined || p.optionalAttendees !== undefined)
    e.attendees = [
      ...list(p.attendees).map((address) => ({
        emailAddress: { address },
        type: "required",
      })),
      ...list(p.optionalAttendees).map((address) => ({
        emailAddress: { address },
        type: "optional",
      })),
    ];
  if (p.isOnlineMeeting !== undefined) {
    e.isOnlineMeeting = p.isOnlineMeeting;
    if (p.isOnlineMeeting) e.onlineMeetingProvider = "teamsForBusiness";
  }
  for (const k of [
    "showAs",
    "importance",
    "sensitivity",
    "categories",
    "recurrence",
  ] as const)
    if (p[k] !== undefined) e[k] = p[k];
  if (p.reminderMinutesBeforeStart !== undefined) {
    e.isReminderOn = true;
    e.reminderMinutesBeforeStart = p.reminderMinutesBeforeStart;
  }
  return e;
}

/** The events collection of the default calendar, or of one named calendar. */
function eventsPath(ctx: Ctx, calendarId: string | undefined): string {
  return calendarId
    ? `${userBase(ctx)}/calendars/${encodeURIComponent(calendarId)}`
    : userBase(ctx);
}

const eventFields = {
  subject: { type: "string", required: false },
  start: {
    type: "string",
    required: false,
    description:
      "ISO datetime. With Z or an offset it is an instant; without, it is read in timeZone. YYYY-MM-DD when allDay.",
  },
  end: {
    type: "string",
    required: false,
    description:
      "ISO datetime, same form as start. For allDay, the day after the last day.",
  },
  timeZone: {
    type: "string",
    required: false,
    description:
      'Zone for start/end without an offset, e.g. "Asia/Jerusalem" (default UTC)',
  },
  allDay: { type: "boolean", required: false },
  body: { type: "string", required: false },
  html: {
    type: "boolean",
    required: false,
    description: "Body is HTML (default plain text)",
  },
  location: { type: "string", required: false },
  attendees: {
    type: "array",
    required: false,
    description: "Required attendee address(es)",
  },
  optionalAttendees: {
    type: "array",
    required: false,
    description: "Optional attendee address(es)",
  },
  isOnlineMeeting: {
    type: "boolean",
    required: false,
    description: "Attach a Teams meeting",
  },
  showAs: {
    type: "string",
    required: false,
    description: "free, tentative, busy, oof, workingElsewhere",
  },
  importance: {
    type: "string",
    required: false,
    description: "low, normal, high",
  },
  sensitivity: {
    type: "string",
    required: false,
    description: "normal, personal, private, confidential",
  },
  reminderMinutesBeforeStart: { type: "number", required: false },
  categories: { type: "array", required: false },
  recurrence: {
    type: "object",
    required: false,
    description:
      "Graph patternedRecurrence {pattern, range}, passed through unchanged",
  },
} as const;

export default function microsoftCalendar(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("1.1.0");
  rl.setCredential(microsoftCredential(NAME, SCOPES));

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "delegated or appOnly; legacy configs infer the method from existing credentials",
    },
    tenantId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_TENANT_ID",
      description: "Entra tenant id (app-only) or omit for OAuth /common",
    },
    clientId: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_ID",
      description: "App (client) id",
    },
    clientSecret: {
      type: "string",
      required: false,
      env: "MS_GRAPH_CLIENT_SECRET",
      description: "Client secret VALUE",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "MICROSOFTCALENDAR_REFRESH_TOKEN",
      description: "OAuth2 refresh token (set by the login flow)",
    },
    userUpn: {
      type: "string",
      required: false,
      env: "MS_GRAPH_USER_UPN",
      description: "App-only only: target user UPN",
    },
  });

  rl.setOAuth({
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: [...SCOPES, "offline_access"],
    setupHelp: microsoftSetupHelp(
      "Calendars.Read, Calendars.ReadWrite and Calendars.Read.Shared",
    ),
  });

  rl.registerAction("calendar.list", {
    access: "read",
    description:
      "List calendar events in a date range, recurring events expanded. Returns [{id,subject,start,end,location,organizer,attendees}].",
    inputSchema: {
      start: {
        type: "string",
        required: true,
        description: "ISO start datetime, e.g. 2026-05-01T00:00:00Z",
      },
      end: { type: "string", required: true, description: "ISO end datetime" },
      top: { type: "number", required: false, default: 50 },
      calendarId: {
        type: "string",
        required: false,
        description: "A calendar from calendar.listCalendars (default calendar if omitted)",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        start: string;
        end: string;
        top?: number;
        calendarId?: string;
      };
      const qs = new URLSearchParams({
        startDateTime: p.start,
        endDateTime: p.end,
        $top: String(p.top ?? 50),
        $select: SELECT,
        $orderby: "start/dateTime",
      });
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        READ_SCOPES,
        "GET",
        `${eventsPath(ctx, p.calendarId)}/calendarView?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.listCalendars", {
    access: "read",
    description:
      "List the user's calendars. Returns [{id,name,color,isDefaultCalendar,canEdit,owner}].",
    inputSchema: {},
    async execute(_input, ctx: Ctx) {
      const qs = new URLSearchParams({
        $select: "id,name,color,isDefaultCalendar,canEdit,owner",
      });
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        READ_SCOPES,
        "GET",
        `${userBase(ctx)}/calendars?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.getSchedule", {
    access: "read",
    description:
      "Free/busy for one or more people in a time range. Returns [{scheduleId,availabilityView,scheduleItems,workingHours}].",
    inputSchema: {
      schedules: {
        type: "array",
        required: true,
        description: "Email address(es) of users, rooms or distribution lists",
      },
      start: {
        type: "string",
        required: true,
        description: "ISO start datetime",
      },
      end: { type: "string", required: true, description: "ISO end datetime" },
      timeZone: {
        type: "string",
        required: false,
        description: "Zone for start/end without an offset (default UTC)",
      },
      intervalMinutes: {
        type: "number",
        required: false,
        default: 30,
        description: "Slot length of availabilityView",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        schedules: string[] | string;
        start: string;
        end: string;
        timeZone?: string;
        intervalMinutes?: number;
      };
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        READ_SCOPES,
        "POST",
        `${userBase(ctx)}/calendar/getSchedule`,
        {
          schedules: list(p.schedules),
          startTime: dateTime(p.start, p.timeZone, false),
          endTime: dateTime(p.end, p.timeZone, false),
          availabilityViewInterval: p.intervalMinutes ?? 30,
        },
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.findMeetingTimes", {
    access: "read",
    description:
      "Suggest meeting times that fit the attendees' free/busy and working hours. Delegated auth only. Returns {suggestions:[{meetingTimeSlot,confidence,attendeeAvailability,suggestionReason}], emptySuggestionsReason}.",
    inputSchema: {
      attendees: {
        type: "array",
        required: true,
        description: "Required attendee address(es)",
      },
      optionalAttendees: { type: "array", required: false },
      start: {
        type: "string",
        required: true,
        description: "Earliest start to consider (ISO)",
      },
      end: {
        type: "string",
        required: true,
        description: "Latest end to consider (ISO)",
      },
      timeZone: {
        type: "string",
        required: false,
        description:
          "Zone for start/end without an offset, and for the suggestions (default UTC)",
      },
      durationMinutes: { type: "number", required: false, default: 30 },
      maxCandidates: { type: "number", required: false, default: 5 },
      activityDomain: {
        type: "string",
        required: false,
        description: "work (working hours, default), personal or unrestricted",
      },
      isOrganizerOptional: { type: "boolean", required: false },
      minimumAttendeePercentage: {
        type: "number",
        required: false,
        description:
          "Lowest share of attendees (0-100) that must be free for a suggestion",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        attendees: string[] | string;
        optionalAttendees?: string[] | string;
        start: string;
        end: string;
        timeZone?: string;
        durationMinutes?: number;
        maxCandidates?: number;
        activityDomain?: string;
        isOrganizerOptional?: boolean;
        minimumAttendeePercentage?: number;
      };
      const r = await graphRequest<{
        meetingTimeSuggestions?: unknown[];
        emptySuggestionsReason?: string;
      }>(
        ctx,
        NAME,
        SHARED_SCOPES,
        "POST",
        `${userBase(ctx)}/findMeetingTimes`,
        {
          attendees: [
            ...recipients(p.attendees).map((a) => ({ ...a, type: "required" })),
            ...recipients(p.optionalAttendees).map((a) => ({
              ...a,
              type: "optional",
            })),
          ],
          timeConstraint: {
            activityDomain: p.activityDomain ?? "work",
            timeSlots: [
              {
                start: dateTime(p.start, p.timeZone, false),
                end: dateTime(p.end, p.timeZone, false),
              },
            ],
          },
          meetingDuration: `PT${p.durationMinutes ?? 30}M`,
          maxCandidates: p.maxCandidates ?? 5,
          returnSuggestionReasons: true,
          ...(p.isOrganizerOptional === undefined
            ? {}
            : { isOrganizerOptional: p.isOrganizerOptional }),
          ...(p.minimumAttendeePercentage === undefined
            ? {}
            : { minimumAttendeePercentage: p.minimumAttendeePercentage }),
        },
      );
      return {
        suggestions: r.meetingTimeSuggestions ?? [],
        emptySuggestionsReason: r.emptySuggestionsReason || undefined,
      };
    },
  });

  rl.registerAction("event.list", {
    access: "read",
    description:
      "Find events by subject, organizer, category or change time. Recurring events come back as their series, not expanded (use calendar.list for a date range). Returns [{id,subject,start,end,location,organizer,attendees}].",
    inputSchema: {
      subject: {
        type: "string",
        required: false,
        description: "Subject contains this text",
      },
      organizer: {
        type: "string",
        required: false,
        description: "Organizer email address",
      },
      category: { type: "string", required: false },
      modifiedSince: {
        type: "string",
        required: false,
        description: "Changed at or after this ISO datetime",
      },
      filter: {
        type: "string",
        required: false,
        description: "Raw OData $filter, ANDed with the fields above",
      },
      orderBy: {
        type: "string",
        required: false,
        description: 'OData $orderby, e.g. "start/dateTime desc"',
      },
      top: { type: "number", required: false, default: 50 },
      calendarId: {
        type: "string",
        required: false,
        description:
          "A calendar from calendar.listCalendars (default calendar if omitted)",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        subject?: string;
        organizer?: string;
        category?: string;
        modifiedSince?: string;
        filter?: string;
        orderBy?: string;
        top?: number;
        calendarId?: string;
      };
      const filters: string[] = [];
      if (p.subject) filters.push(`contains(subject,${literal(p.subject)})`);
      if (p.organizer)
        filters.push(
          `organizer/emailAddress/address eq ${literal(p.organizer)}`,
        );
      if (p.category)
        filters.push(`categories/any(c:c eq ${literal(p.category)})`);
      if (p.modifiedSince) {
        const since = new Date(p.modifiedSince);
        if (Number.isNaN(since.getTime()))
          throw new Error(`${NAME}: invalid datetime ${p.modifiedSince}`);
        filters.push(`lastModifiedDateTime ge ${since.toISOString()}`);
      }
      if (p.filter) filters.push(`(${p.filter})`);
      const qs = new URLSearchParams({
        $top: String(p.top ?? 50),
        $select: SELECT,
      });
      if (filters.length) qs.set("$filter", filters.join(" and "));
      if (p.orderBy) qs.set("$orderby", p.orderBy);
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        READ_SCOPES,
        "GET",
        `${eventsPath(ctx, p.calendarId)}/events?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("event.get", {
    access: "read",
    description: "Get one calendar event by id (full details incl. body).",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string };
      return graphRequest(
        ctx,
        NAME,
        READ_SCOPES,
        "GET",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}`,
      );
    },
  });

  rl.registerAction("event.listInstances", {
    access: "read",
    description:
      "List occurrences of a recurring event (by its series id) in a date range.",
    inputSchema: {
      id: { type: "string", required: true, description: "Series master id" },
      start: { type: "string", required: true, description: "ISO start" },
      end: { type: "string", required: true, description: "ISO end" },
      top: { type: "number", required: false, default: 50 },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string; start: string; end: string; top?: number };
      const qs = new URLSearchParams({
        startDateTime: p.start,
        endDateTime: p.end,
        $top: String(p.top ?? 50),
        $select: SELECT,
      });
      const r = await graphRequest<GraphList>(
        ctx,
        NAME,
        READ_SCOPES,
        "GET",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}/instances?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("event.create", {
    access: "write",
    description:
      "Create a calendar event; attendees are sent invitations. Returns {id, webLink}. Get user approval before inviting others.",
    inputSchema: {
      ...eventFields,
      subject: { type: "string", required: true },
      start: { ...eventFields.start, required: true },
      end: { ...eventFields.end, required: true },
      calendarId: {
        type: "string",
        required: false,
        description: "A calendar from calendar.listCalendars (default calendar if omitted)",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as EventInput & { calendarId?: string };
      const r = await graphRequest<{ id: string; webLink: string }>(
        ctx,
        NAME,
        WRITE_SCOPES,
        "POST",
        `${eventsPath(ctx, p.calendarId)}/events`,
        toEvent(p),
      );
      return { id: r.id, webLink: r.webLink };
    },
  });

  rl.registerAction("event.update", {
    access: "write",
    description:
      "Change an event; only the fields given are changed. Attendees are notified of the change. Returns {id, webLink}.",
    inputSchema: { id: { type: "string", required: true }, ...eventFields },
    async execute(input, ctx: Ctx) {
      const p = input as EventInput & { id: string };
      const r = await graphRequest<{ id: string; webLink: string }>(
        ctx,
        NAME,
        WRITE_SCOPES,
        "PATCH",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}`,
        toEvent(p),
      );
      return { id: r.id, webLink: r.webLink };
    },
  });

  rl.registerAction("event.delete", {
    access: "write",
    description:
      "Delete an event from the calendar. An organizer's delete cancels it for attendees without a message; use event.cancel to send one. Returns {success}.",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string };
      return graphRequest(
        ctx,
        NAME,
        WRITE_SCOPES,
        "DELETE",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}`,
      );
    },
  });

  rl.registerAction("event.cancel", {
    access: "write",
    description:
      "Organizer only: cancel a meeting and send attendees a cancellation with an optional comment. Returns {success}.",
    inputSchema: {
      id: { type: "string", required: true },
      comment: { type: "string", required: false },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string; comment?: string };
      return graphRequest(
        ctx,
        NAME,
        WRITE_SCOPES,
        "POST",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}/cancel`,
        p.comment === undefined ? {} : { comment: p.comment },
      );
    },
  });

  rl.registerAction("event.respond", {
    access: "write",
    description:
      "Accept, tentatively accept or decline a meeting invitation. Returns {success}.",
    inputSchema: {
      id: { type: "string", required: true },
      response: {
        type: "string",
        required: true,
        description: "accept, tentativelyAccept or decline",
      },
      comment: { type: "string", required: false },
      sendResponse: {
        type: "boolean",
        required: false,
        default: true,
        description: "Reply to the organizer",
      },
      proposedStart: {
        type: "string",
        required: false,
        description:
          "decline or tentativelyAccept only: propose this start instead (ISO, same form as event.create)",
      },
      proposedEnd: {
        type: "string",
        required: false,
        description: "End of the proposed time; given with proposedStart",
      },
      timeZone: {
        type: "string",
        required: false,
        description: "Zone for proposedStart/End without an offset (default UTC)",
      },
    },
    async execute(input, ctx: Ctx) {
      const p = input as {
        id: string;
        response: string;
        comment?: string;
        sendResponse?: boolean;
        proposedStart?: string;
        proposedEnd?: string;
        timeZone?: string;
      };
      if (!(RESPONSES as readonly string[]).includes(p.response))
        throw new Error(
          `${NAME}: response must be one of ${RESPONSES.join(", ")}`,
        );
      const proposing =
        p.proposedStart !== undefined || p.proposedEnd !== undefined;
      if (proposing) {
        if (p.proposedStart === undefined || p.proposedEnd === undefined)
          throw new Error(
            `${NAME}: proposedStart and proposedEnd must be given together`,
          );
        if (p.response === "accept")
          throw new Error(
            `${NAME}: a new time can be proposed only with decline or tentativelyAccept`,
          );
        if (p.sendResponse === false)
          throw new Error(
            `${NAME}: proposing a new time sends a response to the organizer`,
          );
      }
      return graphRequest(
        ctx,
        NAME,
        WRITE_SCOPES,
        "POST",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}/${p.response}`,
        {
          sendResponse: p.sendResponse ?? true,
          ...(p.comment === undefined ? {} : { comment: p.comment }),
          ...(proposing
            ? {
                proposedNewTime: {
                  start: dateTime(p.proposedStart as string, p.timeZone, false),
                  end: dateTime(p.proposedEnd as string, p.timeZone, false),
                },
              }
            : {}),
        },
      );
    },
  });

  rl.registerAction("event.forward", {
    access: "write",
    description:
      "Forward a meeting invitation to more people, with an optional comment. Returns {success}. Get user approval before forwarding.",
    inputSchema: {
      id: { type: "string", required: true },
      to: {
        type: "array",
        required: true,
        description: "Recipient address(es)",
      },
      comment: { type: "string", required: false },
    },
    async execute(input, ctx: Ctx) {
      const p = input as { id: string; to: string[] | string; comment?: string };
      if (!list(p.to).length)
        throw new Error(`${NAME}: event.forward needs at least one recipient`);
      return graphRequest(
        ctx,
        NAME,
        WRITE_SCOPES,
        "POST",
        `${userBase(ctx)}/events/${encodeURIComponent(p.id)}/forward`,
        {
          toRecipients: recipients(p.to),
          ...(p.comment === undefined ? {} : { comment: p.comment }),
        },
      );
    },
  });
}
