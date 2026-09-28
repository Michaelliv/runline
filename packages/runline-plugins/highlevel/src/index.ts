import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { HIGHLEVEL_VERSION, highlevelCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function locationOf(ctx: ActionContext): string {
  return ctx.connection.config.locationId as string;
}

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<any> {
  return credentialJson(ctx, highlevelCredential, "highlevel", {
    target: "api",
    path,
    method,
    query: qs,
    headers: { Version: HIGHLEVEL_VERSION },
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function highlevel(rl: RunlinePluginAPI) {
  rl.setName("highlevel");
  rl.setVersion("0.1.0");
  rl.setCredential(highlevelCredential);
  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "OAuth2 access token",
      env: "HIGHLEVEL_ACCESS_TOKEN",
    },
    locationId: {
      type: "string",
      required: true,
      description: "Location ID",
      env: "HIGHLEVEL_LOCATION_ID",
    },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.upsert", {
    access: "write",
    description: "Create or update a contact (upsert by email/phone)",
    inputSchema: {
      email: { type: "string", required: false },
      phone: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      name: { type: "string", required: false },
      address1: { type: "string", required: false },
      city: { type: "string", required: false },
      state: { type: "string", required: false },
      postalCode: { type: "string", required: false },
      website: { type: "string", required: false },
      tags: {
        type: "object",
        required: false,
        description: "Array of tag strings",
      },
      timezone: { type: "string", required: false },
      dnd: { type: "boolean", required: false },
      source: { type: "string", required: false },
      customFields: {
        type: "object",
        required: false,
        description: "Array of {id, field_value}",
      },
    },
    async execute(input, ctx) {
      const locationId = locationOf(ctx);
      const body = { ...(input as Record<string, unknown>), locationId };
      if (typeof body.tags === "string")
        body.tags = (body.tags as string)
          .split(",")
          .map((t: string) => t.trim());
      const res = (await api(ctx, "POST", "contacts/upsert/", body)) as Record<
        string,
        unknown
      >;
      return res.contact ?? res;
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const res = (await api(
        ctx,
        "GET",
        `contacts/${seg((input as Record<string, unknown>).id)}/`,
      )) as Record<string, unknown>;
      return res.contact ?? res;
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false },
      query: {
        type: "string",
        required: false,
        description: "Search by name, phone, email, tags, company",
      },
      sortBy: {
        type: "string",
        required: false,
        description: "date_added or date_updated",
      },
      order: { type: "string", required: false, description: "asc or desc" },
    },
    async execute(input, ctx) {
      const locationId = locationOf(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { locationId };
      if (p.limit) qs.limit = p.limit;
      if (p.query) qs.query = p.query;
      if (p.sortBy) qs.sortBy = p.sortBy;
      if (p.order) qs.order = p.order;
      const res = (await api(ctx, "GET", "contacts/", undefined, qs)) as Record<
        string,
        unknown
      >;
      return res.contacts ?? res;
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      id: { type: "string", required: true },
      email: { type: "string", required: false },
      phone: { type: "string", required: false },
      firstName: { type: "string", required: false },
      lastName: { type: "string", required: false },
      name: { type: "string", required: false },
      address1: { type: "string", required: false },
      city: { type: "string", required: false },
      state: { type: "string", required: false },
      postalCode: { type: "string", required: false },
      website: { type: "string", required: false },
      tags: { type: "object", required: false },
      timezone: { type: "string", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      if (typeof body.tags === "string")
        body.tags = (body.tags as string)
          .split(",")
          .map((t: string) => t.trim());
      const res = (await api(
        ctx,
        "PUT",
        `contacts/${seg(id)}/`,
        body,
      )) as Record<string, unknown>;
      return res.contact ?? res;
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `contacts/${seg((input as Record<string, unknown>).id)}/`,
      );
      return { success: true };
    },
  });

  // ── Opportunity ─────────────────────────────────────

  rl.registerAction("opportunity.create", {
    access: "write",
    description: "Create an opportunity",
    inputSchema: {
      contactId: { type: "string", required: true },
      name: { type: "string", required: true },
      status: {
        type: "string",
        required: true,
        description: "open, won, lost, or abandoned",
      },
      pipelineId: { type: "string", required: true },
      stageId: {
        type: "string",
        required: false,
        description: "Pipeline stage ID",
      },
      monetaryValue: { type: "number", required: false },
      assignedTo: { type: "string", required: false },
      companyName: { type: "string", required: false },
      tags: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const locationId = locationOf(ctx);
      const body = { ...(input as Record<string, unknown>), locationId };
      if (body.stageId) {
        body.pipelineStageId = body.stageId;
        delete body.stageId;
      }
      if (typeof body.tags === "string")
        body.tags = (body.tags as string)
          .split(",")
          .map((t: string) => t.trim());
      return api(ctx, "POST", "opportunities/", body);
    },
  });

  rl.registerAction("opportunity.get", {
    access: "read",
    description: "Get an opportunity",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `opportunities/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("opportunity.list", {
    access: "read",
    description: "List opportunities",
    inputSchema: {
      limit: { type: "number", required: false },
      pipelineId: { type: "string", required: false },
      stageId: { type: "string", required: false },
      status: { type: "string", required: false },
      assignedTo: { type: "string", required: false },
      query: { type: "string", required: false },
      startDate: { type: "string", required: false },
      endDate: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const locationId = locationOf(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { location_id: locationId };
      if (p.limit) qs.limit = p.limit;
      if (p.pipelineId) qs.pipeline_id = p.pipelineId;
      if (p.stageId) qs.pipeline_stage_id = p.stageId;
      if (p.status) qs.status = p.status;
      if (p.assignedTo) qs.assigned_to = p.assignedTo;
      if (p.query) qs.q = p.query;
      if (p.startDate) qs.startDate = new Date(p.startDate as string).getTime();
      if (p.endDate) qs.endDate = new Date(p.endDate as string).getTime();
      const res = (await api(
        ctx,
        "GET",
        "opportunities/search",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return res.opportunities ?? res;
    },
  });

  rl.registerAction("opportunity.update", {
    access: "write",
    description: "Update an opportunity",
    inputSchema: {
      id: { type: "string", required: true },
      name: { type: "string", required: false },
      status: { type: "string", required: false },
      pipelineId: { type: "string", required: false },
      stageId: { type: "string", required: false },
      monetaryValue: { type: "number", required: false },
      assignedTo: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      if (body.stageId) {
        body.pipelineStageId = body.stageId;
        delete body.stageId;
      }
      return api(ctx, "PUT", `opportunities/${seg(id)}`, body);
    },
  });

  rl.registerAction("opportunity.delete", {
    access: "write",
    description: "Delete an opportunity",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `opportunities/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── Task (scoped to contact) ────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task for a contact",
    inputSchema: {
      contactId: { type: "string", required: true },
      title: { type: "string", required: true },
      dueDate: { type: "string", required: true, description: "ISO datetime" },
      completed: { type: "boolean", required: false },
      body: { type: "string", required: false },
      assignedTo: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { contactId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `contacts/${seg(contactId)}/tasks/`, body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task",
    inputSchema: {
      contactId: { type: "string", required: true },
      taskId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "GET",
        `contacts/${seg(p.contactId)}/tasks/${seg(p.taskId)}/`,
      );
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks for a contact",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const res = (await api(
        ctx,
        "GET",
        `contacts/${seg((input as Record<string, unknown>).contactId)}/tasks/`,
      )) as Record<string, unknown>;
      return res.tasks ?? res;
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      contactId: { type: "string", required: true },
      taskId: { type: "string", required: true },
      title: { type: "string", required: false },
      dueDate: { type: "string", required: false },
      completed: { type: "boolean", required: false },
      body: { type: "string", required: false },
      assignedTo: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { contactId, taskId, ...body } = input as Record<string, unknown>;
      return api(
        ctx,
        "PUT",
        `contacts/${seg(contactId)}/tasks/${seg(taskId)}/`,
        body,
      );
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: {
      contactId: { type: "string", required: true },
      taskId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await api(
        ctx,
        "DELETE",
        `contacts/${seg(p.contactId)}/tasks/${seg(p.taskId)}/`,
      );
      return { success: true };
    },
  });

  // ── Calendar ────────────────────────────────────────

  rl.registerAction("calendar.bookAppointment", {
    access: "write",
    description: "Book a calendar appointment",
    inputSchema: {
      calendarId: { type: "string", required: true },
      locationId: { type: "string", required: true },
      contactId: { type: "string", required: true },
      startTime: {
        type: "string",
        required: true,
        description: "ISO datetime with timezone offset",
      },
      endTime: { type: "string", required: false },
      title: { type: "string", required: false },
      appointmentStatus: {
        type: "string",
        required: false,
        description: "new, confirmed, cancelled, showed, noshow, invalid",
      },
      assignedUserId: { type: "string", required: false },
      address: { type: "string", required: false },
      toNotify: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "calendars/events/appointments",
        input as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("calendar.getFreeSlots", {
    access: "read",
    description: "Get free slots for a calendar",
    inputSchema: {
      calendarId: { type: "string", required: true },
      startDate: {
        type: "number",
        required: true,
        description: "Start date as epoch ms",
      },
      endDate: {
        type: "number",
        required: true,
        description: "End date as epoch ms",
      },
      timezone: { type: "string", required: false },
      userId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        startDate: p.startDate,
        endDate: p.endDate,
      };
      if (p.timezone) qs.timezone = p.timezone;
      if (p.userId) qs.userId = p.userId;
      return api(
        ctx,
        "GET",
        `calendars/${seg(p.calendarId)}/free-slots`,
        undefined,
        qs,
      );
    },
  });
}
