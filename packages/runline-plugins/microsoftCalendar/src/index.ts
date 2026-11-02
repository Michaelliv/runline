/**
 * Microsoft Outlook calendar plugin for runline (Microsoft Graph).
 *
 * Auth: the "microsoft" grant (delegated → /me) or app-only
 * (tenantId/clientId/clientSecret + userUpn). See _shared/microsoftAuth.ts.
 * Graph delegated scopes: Calendars.ReadWrite, and Calendars.ReadWrite.Shared
 * for calendars other people shared with the user or made them a delegate
 * of. Those calendars appear in calendar.listCalendars, owner and canEdit
 * included, and every action that takes a calendarId works in them.
 */
import {
  type ActionContext,
  pathSegment,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";
import {
  graphRequest,
  microsoftCredential,
  microsoftOAuth,
  userBase,
} from "../../_shared/microsoftAuth.js";
import { atLeastOne } from "../../_shared/schemas.js";

const NAME = "microsoftCalendar";
const SCOPES = [
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/Calendars.ReadWrite.Shared",
];
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

const STRICT = { additionalProperties: false } as const;
const SELECT =
  "id,subject,start,end,location,organizer,attendees,isAllDay,webLink";

const Id = (description?: string) =>
  t.String({ minLength: 1, ...(description ? { description } : {}) });
const Addresses = (description: string) =>
  t.Array(t.String({ minLength: 1 }), { description });
const Time = (description: string) => t.String({ minLength: 1, description });
const TimeZone = t.Optional(
  t.String({
    minLength: 1,
    description:
      'Zone for times without an offset: a Windows name ("Pacific Standard Time") or an IANA name Graph supports ("Asia/Jerusalem"); default UTC',
  }),
);
const Top = t.Optional(t.Integer({ minimum: 1, description: "Default 50" }));

/**
 * The fields Graph requires for each value of an object's `type`, as its
 * reference tables list them: one branch per type.
 */
function requiredFor(byType: Record<string, string[]>) {
  return {
    anyOf: Object.entries(byType).map(([type, required]) => ({
      properties: { type: { const: type } },
      required,
    })),
  };
}
const CalendarId = t.Optional(
  Id(
    "From calendar.listCalendars, including calendars shared with you or delegated to you; the default calendar when omitted",
  ),
);
const DayOfWeek = t.Union([
  t.Literal("sunday"),
  t.Literal("monday"),
  t.Literal("tuesday"),
  t.Literal("wednesday"),
  t.Literal("thursday"),
  t.Literal("friday"),
  t.Literal("saturday"),
]);
const Recurrence = t.Object(
  {
    pattern: t.Object(
      {
        type: t.Union([
          t.Literal("daily"),
          t.Literal("weekly"),
          t.Literal("absoluteMonthly"),
          t.Literal("relativeMonthly"),
          t.Literal("absoluteYearly"),
          t.Literal("relativeYearly"),
        ]),
        interval: t.Integer({ minimum: 1 }),
        daysOfWeek: t.Optional(t.Array(DayOfWeek, { minItems: 1 })),
        dayOfMonth: t.Optional(t.Integer({ minimum: 1, maximum: 31 })),
        month: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
        index: t.Optional(
          t.Union([
            t.Literal("first"),
            t.Literal("second"),
            t.Literal("third"),
            t.Literal("fourth"),
            t.Literal("last"),
          ]),
        ),
        firstDayOfWeek: t.Optional(DayOfWeek),
      },
      {
        ...STRICT,
        ...requiredFor({
          daily: [],
          weekly: ["daysOfWeek", "firstDayOfWeek"],
          absoluteMonthly: ["dayOfMonth"],
          relativeMonthly: ["daysOfWeek"],
          absoluteYearly: ["dayOfMonth", "month"],
          relativeYearly: ["daysOfWeek", "month"],
        }),
      },
    ),
    range: t.Object(
      {
        type: t.Union([
          t.Literal("endDate"),
          t.Literal("noEnd"),
          t.Literal("numbered"),
        ]),
        startDate: t.String({
          description: "YYYY-MM-DD, the date of the event's start",
        }),
        endDate: t.Optional(t.String({ description: "YYYY-MM-DD" })),
        numberOfOccurrences: t.Optional(t.Integer({ minimum: 1 })),
        recurrenceTimeZone: t.Optional(t.String({ minLength: 1 })),
      },
      {
        ...STRICT,
        ...requiredFor({
          endDate: ["endDate"],
          noEnd: [],
          numbered: ["numberOfOccurrences"],
        }),
      },
    ),
  },
  { ...STRICT, description: "Graph patternedRecurrence, sent as given" },
);

const START =
  "ISO datetime. With Z or an offset it is an instant; without, it is read in timeZone. YYYY-MM-DD when allDay.";
const END =
  "Same form as start, given with it. For allDay, the day after the last day.";

/** The event properties event.create sets and event.update changes. */
const eventChanges = {
  subject: t.Optional(t.String()),
  start: t.Optional(Time(START)),
  end: t.Optional(Time(END)),
  allDay: t.Optional(t.Boolean({ description: "Given with start and end" })),
  body: t.Optional(t.String()),
  location: t.Optional(t.String()),
  attendees: t.Optional(
    Addresses(
      "Required attendees. With optionalAttendees, replaces the whole attendee list",
    ),
  ),
  optionalAttendees: t.Optional(
    Addresses(
      "Optional attendees. With attendees, replaces the whole attendee list",
    ),
  ),
  isOnlineMeeting: t.Optional(
    t.Boolean({ description: "Attach a Teams meeting" }),
  ),
  showAs: t.Optional(
    t.Union([
      t.Literal("free"),
      t.Literal("tentative"),
      t.Literal("busy"),
      t.Literal("oof"),
      t.Literal("workingElsewhere"),
    ]),
  ),
  importance: t.Optional(
    t.Union([t.Literal("low"), t.Literal("normal"), t.Literal("high")]),
  ),
  sensitivity: t.Optional(
    t.Union([
      t.Literal("normal"),
      t.Literal("personal"),
      t.Literal("private"),
      t.Literal("confidential"),
    ]),
  ),
  reminderMinutesBeforeStart: t.Optional(t.Integer({ minimum: 0 })),
  categories: t.Optional(t.Array(t.String({ minLength: 1 }))),
  recurrence: t.Optional(Recurrence),
};
/** The changes, and how their times and body are read. */
const eventFields = {
  ...eventChanges,
  timeZone: TimeZone,
  html: t.Optional(
    t.Boolean({ description: "body is HTML (default plain text)" }),
  ),
};
type EventFields = t.Static<t.TObject<typeof eventFields>>;

/** One event: its id, and the calendar it was listed from. */
const eventRef = {
  id: Id(),
  calendarId: t.Optional(
    Id(
      "The calendar the event was listed from, when not the default calendar, such as one shared with you",
    ),
  ),
};

const calendarList = t.Object(
  {
    start: Time("ISO start datetime, e.g. 2026-05-01T00:00:00Z"),
    end: Time("ISO end datetime"),
    top: Top,
    calendarId: CalendarId,
  },
  STRICT,
);
const getSchedule = t.Object(
  {
    schedules: t.Array(t.String({ minLength: 1 }), {
      minItems: 1,
      description: "Addresses of users, rooms or distribution lists",
    }),
    start: Time("ISO start datetime"),
    end: Time("ISO end datetime"),
    timeZone: TimeZone,
    intervalMinutes: t.Optional(
      t.Integer({
        minimum: 5,
        maximum: 1440,
        description: "Slot length of availabilityView (default 30)",
      }),
    ),
  },
  STRICT,
);
const findMeetingTimes = t.Object(
  {
    attendees: t.Array(t.String({ minLength: 1 }), {
      minItems: 1,
      description:
        "People who must attend; Graph treats every person as required",
    }),
    start: Time("Earliest start to consider (ISO)"),
    end: Time("Latest end to consider (ISO)"),
    timeZone: TimeZone,
    durationMinutes: t.Optional(
      t.Integer({ minimum: 1, description: "Default 30" }),
    ),
    maxCandidates: t.Optional(
      t.Integer({ minimum: 1, description: "Default 5" }),
    ),
    activityDomain: t.Optional(
      t.Union(
        [t.Literal("work"), t.Literal("personal"), t.Literal("unrestricted")],
        { description: "work: within working hours (default)" },
      ),
    ),
    isOrganizerOptional: t.Optional(t.Boolean()),
    minimumAttendeePercentage: t.Optional(
      t.Number({
        minimum: 0,
        maximum: 100,
        description: "Lowest confidence (0-100) a suggestion must have",
      }),
    ),
  },
  STRICT,
);
const eventList = t.Object(
  {
    subject: t.Optional(Id("Subject contains this text")),
    organizer: t.Optional(Id("Organizer email address")),
    category: t.Optional(Id()),
    modifiedSince: t.Optional(Time("Changed at or after this ISO datetime")),
    filter: t.Optional(Id("Raw OData $filter, ANDed with the fields above")),
    orderBy: t.Optional(Id('OData $orderby, e.g. "start/dateTime desc"')),
    top: Top,
    calendarId: CalendarId,
  },
  STRICT,
);
const eventGet = t.Object(eventRef, STRICT);
const eventInstances = t.Object(
  {
    ...eventRef,
    id: Id("Series master id"),
    start: Time("ISO start"),
    end: Time("ISO end"),
    top: Top,
  },
  STRICT,
);
const eventCreate = t.Object(
  {
    ...eventFields,
    subject: t.String(),
    start: Time(START),
    end: Time(END),
    calendarId: CalendarId,
  },
  STRICT,
);
const eventUpdate = t.Object(
  { ...eventRef, ...eventFields },
  { ...STRICT, ...atLeastOne(eventChanges) },
);
const eventCancel = t.Object(
  { ...eventRef, comment: t.Optional(t.String()) },
  STRICT,
);
const eventRespond = t.Object(
  {
    ...eventRef,
    response: t.Union([
      t.Literal("accept"),
      t.Literal("tentativelyAccept"),
      t.Literal("decline"),
    ]),
    comment: t.Optional(t.String()),
    sendResponse: t.Optional(
      t.Boolean({ description: "Reply to the organizer (default true)" }),
    ),
    proposedStart: t.Optional(
      Time(
        "decline or tentativelyAccept only, for meetings that allow new time proposals: propose this start instead, same form as event.create",
      ),
    ),
    proposedEnd: t.Optional(
      Time("End of the proposed time; given with proposedStart"),
    ),
    timeZone: TimeZone,
  },
  STRICT,
);
const eventForward = t.Object(
  {
    ...eventRef,
    to: t.Array(t.String({ minLength: 1 }), {
      minItems: 1,
      description: "Recipient addresses",
    }),
    comment: t.Optional(t.String()),
  },
  STRICT,
);

const recipients = (addresses: readonly string[] | undefined) =>
  (addresses ?? []).map((address) => ({ emailAddress: { address } }));

/** An OData string literal: single quotes doubled. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** A valid ISO instant, or a refusal naming the field. */
function instant(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`${NAME}: ${field} is not an ISO datetime`);
  return parsed;
}

/**
 * Graph's dateTimeTimeZone for a time: one with `Z` or an offset is an
 * instant and goes in UTC; one without is a wall-clock time read in
 * `timeZone` (default UTC); an all-day date is midnight of that date.
 */
function dateTime(
  value: string,
  field: string,
  timeZone: string | undefined,
  allDay = false,
): DateTimeTimeZone {
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error(`${NAME}: ${field} of an all-day event is YYYY-MM-DD`);
    return { dateTime: `${value}T00:00:00`, timeZone: timeZone ?? "UTC" };
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(value))
    return {
      dateTime: instant(value, field).toISOString().slice(0, -1),
      timeZone: "UTC",
    };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value))
    throw new Error(`${NAME}: ${field} is not an ISO datetime`);
  return { dateTime: value, timeZone: timeZone ?? "UTC" };
}

/** A Graph event from the fields given; an update patches only those. */
function toEvent(p: EventFields): Record<string, unknown> {
  const e: Record<string, unknown> = {};
  if (p.start !== undefined || p.end !== undefined || p.allDay !== undefined) {
    if (p.start === undefined || p.end === undefined)
      throw new Error(`${NAME}: start and end are given together`);
    const allDay = p.allDay === true;
    e.start = dateTime(p.start, "start", p.timeZone, allDay);
    e.end = dateTime(p.end, "end", p.timeZone, allDay);
    e.isAllDay = allDay;
  }
  if (p.subject !== undefined) e.subject = p.subject;
  if (p.body !== undefined)
    e.body = { contentType: p.html ? "HTML" : "Text", content: p.body };
  if (p.location !== undefined) e.location = { displayName: p.location };
  if (p.attendees !== undefined || p.optionalAttendees !== undefined)
    e.attendees = [
      ...recipients(p.attendees).map((a) => ({ ...a, type: "required" })),
      ...recipients(p.optionalAttendees).map((a) => ({
        ...a,
        type: "optional",
      })),
    ];
  if (p.isOnlineMeeting !== undefined) {
    e.isOnlineMeeting = p.isOnlineMeeting;
    if (p.isOnlineMeeting) e.onlineMeetingProvider = "teamsForBusiness";
  }
  if (p.showAs !== undefined) e.showAs = p.showAs;
  if (p.importance !== undefined) e.importance = p.importance;
  if (p.sensitivity !== undefined) e.sensitivity = p.sensitivity;
  if (p.categories !== undefined) e.categories = p.categories;
  if (p.recurrence !== undefined) e.recurrence = p.recurrence;
  if (p.reminderMinutesBeforeStart !== undefined) {
    e.isReminderOn = true;
    e.reminderMinutesBeforeStart = p.reminderMinutesBeforeStart;
  }
  return e;
}

/** The mailbox, or one calendar in it: the default calendar when no id. */
function calendarPath(ctx: Ctx, calendarId: string | undefined): string {
  return calendarId
    ? `${userBase(ctx)}/calendars/${pathSegment(calendarId)}`
    : userBase(ctx);
}

/** One event, under the calendar it was listed from. */
function eventPath(ctx: Ctx, ref: { id: string; calendarId?: string }): string {
  return `${calendarPath(ctx, ref.calendarId)}/events/${pathSegment(ref.id)}`;
}

function graph<T = unknown>(
  ctx: Ctx,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return graphRequest<T>(ctx, NAME, SCOPES, method, path, body);
}

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

  rl.setOAuth(
    microsoftOAuth(
      SCOPES,
      "Calendars.ReadWrite and Calendars.ReadWrite.Shared",
    ),
  );

  rl.registerAction("calendar.list", {
    access: "read",
    description:
      "List events in a date range, recurring events expanded. Returns [{id,subject,start,end,location,organizer,attendees,isAllDay,webLink}].",
    inputSchema: calendarList,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof calendarList>;
      const qs = new URLSearchParams({
        startDateTime: p.start,
        endDateTime: p.end,
        $top: String(p.top ?? 50),
        $select: SELECT,
        $orderby: "start/dateTime",
      });
      const r = await graph<GraphList>(
        ctx,
        "GET",
        `${calendarPath(ctx, p.calendarId)}/calendarView?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.listCalendars", {
    access: "read",
    description:
      "List the calendars you can use, including ones shared with you or delegated to you (owner names whose they are; canEdit says whether you may write). Returns [{id,name,color,isDefaultCalendar,canEdit,owner}].",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx: Ctx) {
      const qs = new URLSearchParams({
        $select: "id,name,color,isDefaultCalendar,canEdit,owner",
      });
      const r = await graph<GraphList>(
        ctx,
        "GET",
        `${userBase(ctx)}/calendars?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.getSchedule", {
    access: "read",
    description:
      "Free/busy for people, rooms or lists in a time range. Work or school accounts only. Returns [{scheduleId,availabilityView,scheduleItems,workingHours}].",
    inputSchema: getSchedule,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof getSchedule>;
      const r = await graph<GraphList>(
        ctx,
        "POST",
        `${userBase(ctx)}/calendar/getSchedule`,
        {
          schedules: p.schedules,
          startTime: dateTime(p.start, "start", p.timeZone),
          endTime: dateTime(p.end, "end", p.timeZone),
          availabilityViewInterval: p.intervalMinutes ?? 30,
        },
      );
      return r.value;
    },
  });

  rl.registerAction("calendar.findMeetingTimes", {
    access: "read",
    description:
      "Suggest meeting times that fit the attendees' free/busy and working hours. Delegated connections of work or school accounts only. Returns {suggestions:[{meetingTimeSlot,confidence,attendeeAvailability,suggestionReason}], emptySuggestionsReason}.",
    inputSchema: findMeetingTimes,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof findMeetingTimes>;
      const r = await graph<{
        meetingTimeSuggestions?: unknown[];
        emptySuggestionsReason?: string;
      }>(ctx, "POST", `${userBase(ctx)}/findMeetingTimes`, {
        attendees: recipients(p.attendees).map((a) => ({
          ...a,
          type: "required",
        })),
        timeConstraint: {
          activityDomain: p.activityDomain ?? "work",
          timeSlots: [
            {
              start: dateTime(p.start, "start", p.timeZone),
              end: dateTime(p.end, "end", p.timeZone),
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
      });
      return {
        suggestions: r.meetingTimeSuggestions ?? [],
        emptySuggestionsReason: r.emptySuggestionsReason || undefined,
      };
    },
  });

  rl.registerAction("event.list", {
    access: "read",
    description:
      "Find events by subject, organizer, category or change time. Recurring events come back as their series, not expanded (use calendar.list for a date range). Returns [{id,subject,start,end,location,organizer,attendees,isAllDay,webLink}].",
    inputSchema: eventList,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventList>;
      const filters: string[] = [];
      if (p.subject) filters.push(`contains(subject,${literal(p.subject)})`);
      if (p.organizer)
        filters.push(
          `organizer/emailAddress/address eq ${literal(p.organizer)}`,
        );
      if (p.category)
        filters.push(`categories/any(c:c eq ${literal(p.category)})`);
      if (p.modifiedSince)
        filters.push(
          `lastModifiedDateTime ge ${instant(p.modifiedSince, "modifiedSince").toISOString()}`,
        );
      if (p.filter) filters.push(`(${p.filter})`);
      const qs = new URLSearchParams({
        $top: String(p.top ?? 50),
        $select: SELECT,
      });
      if (filters.length) qs.set("$filter", filters.join(" and "));
      if (p.orderBy) qs.set("$orderby", p.orderBy);
      const r = await graph<GraphList>(
        ctx,
        "GET",
        `${calendarPath(ctx, p.calendarId)}/events?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("event.get", {
    access: "read",
    description: "Get one calendar event by id (full details incl. body).",
    inputSchema: eventGet,
    async execute(input, ctx: Ctx) {
      return graph(
        ctx,
        "GET",
        eventPath(ctx, input as t.Static<typeof eventGet>),
      );
    },
  });

  rl.registerAction("event.listInstances", {
    access: "read",
    description:
      "List occurrences of a recurring event (by its series id) in a date range.",
    inputSchema: eventInstances,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventInstances>;
      const qs = new URLSearchParams({
        startDateTime: p.start,
        endDateTime: p.end,
        $top: String(p.top ?? 50),
        $select: SELECT,
      });
      const r = await graph<GraphList>(
        ctx,
        "GET",
        `${eventPath(ctx, p)}/instances?${qs}`,
      );
      return r.value;
    },
  });

  rl.registerAction("event.create", {
    access: "write",
    description:
      "Create a calendar event; attendees are sent invitations. Returns {id, webLink}. Get user approval before inviting others.",
    inputSchema: eventCreate,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventCreate>;
      const r = await graph<{ id: string; webLink: string }>(
        ctx,
        "POST",
        `${calendarPath(ctx, p.calendarId)}/events`,
        toEvent(p),
      );
      return { id: r.id, webLink: r.webLink };
    },
  });

  rl.registerAction("event.update", {
    access: "write",
    description:
      "Change an event; only the fields given change. Attendees are notified. Returns {id, webLink}.",
    inputSchema: eventUpdate,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventUpdate>;
      const r = await graph<{ id: string; webLink: string }>(
        ctx,
        "PATCH",
        eventPath(ctx, p),
        toEvent(p),
      );
      return { id: r.id, webLink: r.webLink };
    },
  });

  rl.registerAction("event.delete", {
    access: "write",
    description:
      "Delete an event. Deleting a meeting from the organizer's calendar sends attendees a cancellation; event.cancel also carries a comment. Returns {success}.",
    inputSchema: eventGet,
    async execute(input, ctx: Ctx) {
      return graph(
        ctx,
        "DELETE",
        eventPath(ctx, input as t.Static<typeof eventGet>),
      );
    },
  });

  rl.registerAction("event.cancel", {
    access: "write",
    description:
      "Organizer only: cancel a meeting and send attendees a cancellation with an optional comment. Returns {success}.",
    inputSchema: eventCancel,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventCancel>;
      return graph(
        ctx,
        "POST",
        `${eventPath(ctx, p)}/cancel`,
        p.comment === undefined ? {} : { comment: p.comment },
      );
    },
  });

  rl.registerAction("event.respond", {
    access: "write",
    description:
      "Accept, tentatively accept or decline a meeting invitation, optionally proposing a new time. Returns {success}.",
    inputSchema: eventRespond,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventRespond>;
      const proposing =
        p.proposedStart !== undefined || p.proposedEnd !== undefined;
      if (proposing) {
        if (p.proposedStart === undefined || p.proposedEnd === undefined)
          throw new Error(
            `${NAME}: proposedStart and proposedEnd are given together`,
          );
        if (p.response === "accept")
          throw new Error(
            `${NAME}: a new time is proposed only with decline or tentativelyAccept`,
          );
        if (p.sendResponse === false)
          throw new Error(
            `${NAME}: proposing a new time sends a response to the organizer`,
          );
      }
      return graph(ctx, "POST", `${eventPath(ctx, p)}/${p.response}`, {
        sendResponse: p.sendResponse ?? true,
        ...(p.comment === undefined ? {} : { comment: p.comment }),
        ...(p.proposedStart !== undefined && p.proposedEnd !== undefined
          ? {
              proposedNewTime: {
                start: dateTime(p.proposedStart, "proposedStart", p.timeZone),
                end: dateTime(p.proposedEnd, "proposedEnd", p.timeZone),
              },
            }
          : {}),
      });
    },
  });

  rl.registerAction("event.forward", {
    access: "write",
    description:
      "Forward a meeting invitation to more people, with an optional comment. Returns {success}. Get user approval before forwarding.",
    inputSchema: eventForward,
    async execute(input, ctx: Ctx) {
      const p = input as t.Static<typeof eventForward>;
      return graph(ctx, "POST", `${eventPath(ctx, p)}/forward`, {
        toRecipients: recipients(p.to),
        ...(p.comment === undefined ? {} : { comment: p.comment }),
      });
    },
  });
}
