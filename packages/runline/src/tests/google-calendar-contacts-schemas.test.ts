import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import googleCalendar from "../../../runline-plugins/googleCalendar/src/index.js";
import googleContacts from "../../../runline-plugins/googleContacts/src/index.js";
import type { RunlinePluginAPI } from "../plugin/api.js";
import { createPluginAPI } from "../plugin/api.js";
import { isTypedInputSchema } from "../plugin/schema.js";
import type {
  ActionContext,
  ActionDef,
  PluginDef,
  TypedInputSchema,
} from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makePlugin(
  name: string,
  register: (api: RunlinePluginAPI) => void,
): PluginDef {
  const { api, resolve } = createPluginAPI(name);
  register(api);
  return resolve();
}

const calendar = makePlugin("googleCalendar", googleCalendar);
const contacts = makePlugin("googleContacts", googleContacts);

function action(plugin: PluginDef, name: string): ActionDef {
  const found = plugin.actions.find((candidate) => candidate.name === name);
  assert.ok(found, `expected ${plugin.name}.${name} to be registered`);
  return found;
}

function schema(plugin: PluginDef, name: string): TypedInputSchema {
  const inputSchema = action(plugin, name).inputSchema;
  assert.ok(
    isTypedInputSchema(inputSchema),
    `expected ${plugin.name}.${name} to use TypeBox`,
  );
  return inputSchema;
}

function assertValid(plugin: PluginDef, name: string, input: unknown): void {
  assert.equal(
    Check(schema(plugin, name), input),
    true,
    `expected ${plugin.name}.${name} input to be valid: ${JSON.stringify(input)}`,
  );
}

function assertInvalid(plugin: PluginDef, name: string, input: unknown): void {
  assert.equal(
    Check(schema(plugin, name), input),
    false,
    `expected ${plugin.name}.${name} input to be invalid: ${JSON.stringify(input)}`,
  );
}

const calendarFixtures: Record<string, Record<string, unknown>> = {
  "calendar.list": {},
  "calendar.get": { calendarId: "primary" },
  "calendar.availability": {
    calendarId: "primary",
    timeMin: "2026-01-01T00:00:00Z",
    timeMax: "2026-01-02T00:00:00Z",
  },
  "calendar.listColors": {},
  "event.create": {
    calendarId: "primary",
    start: "2026-01-01T10:00:00Z",
    end: "2026-01-01T11:00:00Z",
  },
  "event.get": { calendarId: "primary", eventId: "event-1" },
  "event.list": { calendarId: "primary" },
  "event.listInstances": { calendarId: "primary", eventId: "event-1" },
  "event.update": {
    calendarId: "primary",
    eventId: "event-1",
    summary: "Updated",
  },
  "event.delete": { calendarId: "primary", eventId: "event-1" },
  "event.move": {
    calendarId: "primary",
    eventId: "event-1",
    destinationCalendarId: "other@example.com",
  },
  "freeBusy.query": {
    calendarIds: ["primary"],
    timeMin: "2026-01-01T00:00:00Z",
    timeMax: "2026-01-02T00:00:00Z",
  },
  "calendarList.list": {},
  "calendarList.insert": { calendarId: "other@example.com" },
  "calendarList.patch": { calendarId: "other@example.com", selected: false },
  "calendarList.delete": { calendarId: "other@example.com" },
  "acl.list": { calendarId: "primary" },
  "acl.insert": {
    calendarId: "primary",
    role: "reader",
    scopeType: "default",
  },
  "acl.update": { calendarId: "primary", ruleId: "rule-1", role: "writer" },
  "acl.delete": { calendarId: "primary", ruleId: "rule-1" },
  "settings.list": {},
  "settings.get": { setting: "timezone" },
};

const contactFixtures: Record<string, Record<string, unknown>> = {
  "contact.create": {},
  "contact.get": { contactId: "c123" },
  "contact.list": {},
  "contact.update": { contactId: "c123", givenName: "Ada" },
  "contact.delete": { contactId: "c123" },
  "group.list": {},
  "group.get": { groupId: "friends" },
  "group.create": { name: "Friends" },
  "group.update": { groupId: "friends", name: "Close friends" },
  "group.delete": { groupId: "friends" },
};

function assertSchemaContracts(
  plugin: PluginDef,
  fixtures: Record<string, Record<string, unknown>>,
): void {
  assert.deepEqual(
    plugin.actions.map((action) => action.name),
    Object.keys(fixtures),
  );

  for (const [name, fixture] of Object.entries(fixtures)) {
    const actionSchema = schema(plugin, name);
    assert.equal(
      actionSchema.type,
      "object",
      `${plugin.name}.${name} must be an object`,
    );
    assert.equal(
      actionSchema.additionalProperties,
      false,
      `${plugin.name}.${name} must reject unknown fields`,
    );
    assertValid(plugin, name, fixture);
    assertInvalid(plugin, name, { ...fixture, unexpected: true });

    for (const required of actionSchema.required ?? []) {
      const withoutRequired = { ...fixture };
      delete withoutRequired[required];
      assertInvalid(plugin, name, withoutRequired);
    }

    for (const property of Object.keys(actionSchema.properties ?? {})) {
      assertInvalid(plugin, name, {
        ...fixture,
        [property]: Symbol(`invalid-${property}`),
      });
    }
  }
}

describe("Google Calendar TypeBox schemas", () => {
  it("registers and strictly validates every action", () => {
    assert.equal(calendar.actions.length, 22);
    assertSchemaContracts(calendar, calendarFixtures);
  });

  it("types attendees, reminders, recurrence, and event update pairs", () => {
    const base = calendarFixtures["event.create"];
    assertValid(calendar, "event.create", {
      ...base,
      attendees: "a@example.com, b@example.com",
      reminders: [
        { method: "email", minutes: 30 },
        { method: "popup", minutes: 5 },
      ],
      repeatFrequency: "weekly",
      repeatHowManyTimes: 4,
    });
    assertValid(calendar, "event.create", {
      ...base,
      attendees: ["a@example.com", "b@example.com"],
      rrule: "FREQ=WEEKLY;COUNT=4",
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      attendees: [{ email: "a@example.com" }],
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      reminders: [{ method: "sms", minutes: 5 }],
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      reminders: [{ method: "popup", minutes: 1.5 }],
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      repeatHowManyTimes: 2,
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      repeatHowManyTimes: 2,
      repeatUntil: "2026-02-01T00:00:00Z",
    });
    assertInvalid(calendar, "event.create", {
      ...base,
      rrule: "FREQ=WEEKLY",
      repeatFrequency: "weekly",
    });
    assertInvalid(calendar, "event.update", {
      calendarId: "primary",
      eventId: "event-1",
    });
    assertInvalid(calendar, "event.update", {
      calendarId: "primary",
      eventId: "event-1",
      start: "2026-01-01T10:00:00Z",
    });
    assertInvalid(calendar, "event.update", {
      calendarId: "primary",
      eventId: "event-1",
      allDay: true,
    });
    assertValid(calendar, "event.update", {
      calendarId: "primary",
      eventId: "event-1",
      start: "2026-01-01T10:00:00Z",
      end: "2026-01-01T11:00:00Z",
    });
    assertValid(calendar, "event.update", {
      calendarId: "primary",
      eventId: "event-1",
      attendees: [],
    });
  });

  it("sends an empty attendees array when clearing event guests", async () => {
    let body: unknown;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
      return Response.json({ id: "event-1" });
    }) as typeof fetch;

    const context: ActionContext = {
      connection: {
        name: "googleCalendar",
        plugin: "googleCalendar",
        config: {
          accessToken: "token",
          accessTokenExpiresAt: Date.now() + 3_600_000,
        },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };

    await action(calendar, "event.update").execute(
      { calendarId: "primary", eventId: "event-1", attendees: [] },
      context,
    );

    assert.deepEqual(body, { attendees: [] });
  });

  it("validates availability, free/busy, list enums, and ACL scope rules", () => {
    assertInvalid(calendar, "calendar.availability", {
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
    });
    assertInvalid(calendar, "calendar.availability", {
      calendarIds: [],
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
    });
    assertInvalid(calendar, "calendar.availability", {
      calendarId: "primary",
      calendarIds: ["secondary"],
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
    });
    assertInvalid(calendar, "calendarList.patch", {
      calendarId: "primary",
    });
    assertInvalid(calendar, "calendar.availability", {
      calendarId: "primary",
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
      outputFormat: "compact",
    });
    assertInvalid(calendar, "freeBusy.query", {
      calendarIds: [],
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
    });
    assertInvalid(calendar, "calendar.list", { minAccessRole: "admin" });
    assertInvalid(calendar, "acl.insert", {
      calendarId: "primary",
      role: "reader",
      scopeType: "default",
      scopeValue: "not-valid-for-default",
    });
    assertInvalid(calendar, "acl.insert", {
      calendarId: "primary",
      role: "reader",
      scopeType: "user",
    });
    assertValid(calendar, "acl.insert", {
      calendarId: "primary",
      role: "reader",
      scopeType: "user",
      scopeValue: "reader@example.com",
    });
    assertInvalid(calendar, "acl.insert", {
      calendarId: "primary",
      role: "editor",
      scopeType: "default",
    });
  });
});

describe("Google Contacts TypeBox schemas", () => {
  it("registers and strictly validates every action", () => {
    assert.equal(contacts.actions.length, 10);
    assertSchemaContracts(contacts, contactFixtures);
  });

  it("types writable People API entries and structured dates", () => {
    assertValid(contacts, "contact.create", {
      phoneNumbers: [{ value: "+1 555 0100", type: "mobile" }],
      emailAddresses: [{ value: "ada@example.com", type: "work" }],
      addresses: [
        {
          streetAddress: "1 Computing Way",
          city: "London",
          countryCode: "GB",
          type: "work",
        },
      ],
      organizations: [
        {
          name: "Analytical Engines",
          title: "Programmer",
          startDate: { year: 1843, month: 1, day: 1 },
          current: true,
        },
      ],
      relations: [{ person: "Charles Babbage", type: "colleague" }],
      urls: [{ value: "https://example.com", type: "profile" }],
      events: [{ date: { month: 12, day: 10 }, type: "anniversary" }],
      birthday: "1815-12-10",
      userDefined: [{ key: "source", value: "runline" }],
      groups: ["friends", "contactGroups/work"],
    });
    assertInvalid(contacts, "contact.create", {
      phoneNumbers: [{ type: "mobile" }],
    });
    assertInvalid(contacts, "contact.create", {
      events: [{ date: { month: 13, day: 1 } }],
    });
    assertValid(contacts, "contact.create", {
      addresses: [{ city: "London", futureProviderField: true }],
      organizations: [
        { name: "Analytical Engines", metadata: { primary: true } },
      ],
    });
    assertInvalid(contacts, "contact.create", {
      addresses: [{ city: 42 }],
    });
  });

  it("preserves field unions and enforces meaningful updates", () => {
    assertValid(contacts, "contact.get", {
      contactId: "people/c123",
      fields: ["names", "emailAddresses"],
    });
    assertValid(contacts, "contact.get", {
      contactId: "c123",
      fields: "names,emailAddresses",
    });
    assertInvalid(contacts, "contact.get", {
      contactId: "c123",
      fields: ["names", 42],
    });
    assertInvalid(contacts, "contact.get", {
      contactId: "c123",
      fields: ["names", "notARealPersonField"],
    });
    assertInvalid(contacts, "contact.update", { contactId: "c123" });
    assertInvalid(contacts, "group.update", { groupId: "friends" });
    assertValid(contacts, "group.update", {
      groupId: "friends",
      clientData: [{ key: "source", value: "runline" }],
    });
    assertInvalid(contacts, "group.update", {
      groupId: "friends",
      clientData: [{ key: "source" }],
    });
  });
});
