import type { RunlinePluginAPI } from "runline";

const BASE = "https://services.leadconnectorhq.com";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  return {
    token: ctx.connection.config.accessToken as string,
    locationId: ctx.connection.config.locationId as string,
  };
}

async function api(token: string, method: string, path: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", Version: "2021-07-28" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`HighLevel error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

export default function highlevel(rl: RunlinePluginAPI) {
  rl.setName("highlevel");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "OAuth2 access token", env: "HIGHLEVEL_ACCESS_TOKEN" },
    locationId: { type: "string", required: true, description: "Location ID", env: "HIGHLEVEL_LOCATION_ID" },
  });

  // ── Contact ─────────────────────────────────────────

  rl.registerAction("contact.upsert", { description: "Create or update a contact (upsert by email/phone)",
    inputSchema: { email: { type: "string", required: false }, phone: { type: "string", required: false }, firstName: { type: "string", required: false }, lastName: { type: "string", required: false }, name: { type: "string", required: false }, address1: { type: "string", required: false }, city: { type: "string", required: false }, state: { type: "string", required: false }, postalCode: { type: "string", required: false }, website: { type: "string", required: false }, tags: { type: "object", required: false, description: "Array of tag strings" }, timezone: { type: "string", required: false }, dnd: { type: "boolean", required: false }, source: { type: "string", required: false }, customFields: { type: "object", required: false, description: "Array of {id, field_value}" } },
    async execute(input, ctx) {
      const { token, locationId } = getConn(ctx);
      const body = { ...(input as Record<string, unknown>), locationId };
      if (typeof body.tags === "string") body.tags = (body.tags as string).split(",").map((t: string) => t.trim());
      const res = await api(token, "POST", "/contacts/upsert/", body) as Record<string, unknown>;
      return res.contact ?? res;
    } });

  rl.registerAction("contact.get", { description: "Get a contact by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); const res = await api(token, "GET", `/contacts/${(input as Record<string, unknown>).id}/`) as Record<string, unknown>; return res.contact ?? res; } });

  rl.registerAction("contact.list", { description: "List contacts",
    inputSchema: { limit: { type: "number", required: false }, query: { type: "string", required: false, description: "Search by name, phone, email, tags, company" }, sortBy: { type: "string", required: false, description: "date_added or date_updated" }, order: { type: "string", required: false, description: "asc or desc" } },
    async execute(input, ctx) {
      const { token, locationId } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { locationId };
      if (p.limit) qs.limit = p.limit;
      if (p.query) qs.query = p.query;
      if (p.sortBy) qs.sortBy = p.sortBy;
      if (p.order) qs.order = p.order;
      const res = await api(token, "GET", "/contacts/", undefined, qs) as Record<string, unknown>;
      return res.contacts ?? res;
    } });

  rl.registerAction("contact.update", { description: "Update a contact",
    inputSchema: { id: { type: "string", required: true }, email: { type: "string", required: false }, phone: { type: "string", required: false }, firstName: { type: "string", required: false }, lastName: { type: "string", required: false }, name: { type: "string", required: false }, address1: { type: "string", required: false }, city: { type: "string", required: false }, state: { type: "string", required: false }, postalCode: { type: "string", required: false }, website: { type: "string", required: false }, tags: { type: "object", required: false }, timezone: { type: "string", required: false }, customFields: { type: "object", required: false } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const { id, ...body } = input as Record<string, unknown>;
      if (typeof body.tags === "string") body.tags = (body.tags as string).split(",").map((t: string) => t.trim());
      const res = await api(token, "PUT", `/contacts/${id}/`, body) as Record<string, unknown>;
      return res.contact ?? res;
    } });

  rl.registerAction("contact.delete", { description: "Delete a contact", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); await api(token, "DELETE", `/contacts/${(input as Record<string, unknown>).id}/`); return { success: true }; } });

  // ── Opportunity ─────────────────────────────────────

  rl.registerAction("opportunity.create", { description: "Create an opportunity",
    inputSchema: { contactId: { type: "string", required: true }, name: { type: "string", required: true }, status: { type: "string", required: true, description: "open, won, lost, or abandoned" }, pipelineId: { type: "string", required: true }, stageId: { type: "string", required: false, description: "Pipeline stage ID" }, monetaryValue: { type: "number", required: false }, assignedTo: { type: "string", required: false }, companyName: { type: "string", required: false }, tags: { type: "object", required: false } },
    async execute(input, ctx) {
      const { token, locationId } = getConn(ctx);
      const body = { ...(input as Record<string, unknown>), locationId };
      if (body.stageId) { body.pipelineStageId = body.stageId; delete body.stageId; }
      if (typeof body.tags === "string") body.tags = (body.tags as string).split(",").map((t: string) => t.trim());
      return api(token, "POST", "/opportunities/", body);
    } });

  rl.registerAction("opportunity.get", { description: "Get an opportunity", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); return api(token, "GET", `/opportunities/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("opportunity.list", { description: "List opportunities",
    inputSchema: { limit: { type: "number", required: false }, pipelineId: { type: "string", required: false }, stageId: { type: "string", required: false }, status: { type: "string", required: false }, assignedTo: { type: "string", required: false }, query: { type: "string", required: false }, startDate: { type: "string", required: false }, endDate: { type: "string", required: false } },
    async execute(input, ctx) {
      const { token, locationId } = getConn(ctx);
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
      const res = await api(token, "GET", "/opportunities/search", undefined, qs) as Record<string, unknown>;
      return res.opportunities ?? res;
    } });

  rl.registerAction("opportunity.update", { description: "Update an opportunity",
    inputSchema: { id: { type: "string", required: true }, name: { type: "string", required: false }, status: { type: "string", required: false }, pipelineId: { type: "string", required: false }, stageId: { type: "string", required: false }, monetaryValue: { type: "number", required: false }, assignedTo: { type: "string", required: false } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const { id, ...body } = input as Record<string, unknown>;
      if (body.stageId) { body.pipelineStageId = body.stageId; delete body.stageId; }
      return api(token, "PUT", `/opportunities/${id}`, body);
    } });

  rl.registerAction("opportunity.delete", { description: "Delete an opportunity", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); await api(token, "DELETE", `/opportunities/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  // ── Task (scoped to contact) ────────────────────────

  rl.registerAction("task.create", { description: "Create a task for a contact",
    inputSchema: { contactId: { type: "string", required: true }, title: { type: "string", required: true }, dueDate: { type: "string", required: true, description: "ISO datetime" }, completed: { type: "boolean", required: false }, body: { type: "string", required: false }, assignedTo: { type: "string", required: false } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const { contactId, ...body } = input as Record<string, unknown>;
      return api(token, "POST", `/contacts/${contactId}/tasks/`, body);
    } });

  rl.registerAction("task.get", { description: "Get a task",
    inputSchema: { contactId: { type: "string", required: true }, taskId: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); const p = input as Record<string, unknown>; return api(token, "GET", `/contacts/${p.contactId}/tasks/${p.taskId}/`); } });

  rl.registerAction("task.list", { description: "List tasks for a contact",
    inputSchema: { contactId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const res = await api(token, "GET", `/contacts/${(input as Record<string, unknown>).contactId}/tasks/`) as Record<string, unknown>;
      return res.tasks ?? res;
    } });

  rl.registerAction("task.update", { description: "Update a task",
    inputSchema: { contactId: { type: "string", required: true }, taskId: { type: "string", required: true }, title: { type: "string", required: false }, dueDate: { type: "string", required: false }, completed: { type: "boolean", required: false }, body: { type: "string", required: false }, assignedTo: { type: "string", required: false } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const { contactId, taskId, ...body } = input as Record<string, unknown>;
      return api(token, "PUT", `/contacts/${contactId}/tasks/${taskId}/`, body);
    } });

  rl.registerAction("task.delete", { description: "Delete a task",
    inputSchema: { contactId: { type: "string", required: true }, taskId: { type: "string", required: true } },
    async execute(input, ctx) { const { token } = getConn(ctx); const p = input as Record<string, unknown>; await api(token, "DELETE", `/contacts/${p.contactId}/tasks/${p.taskId}/`); return { success: true }; } });

  // ── Calendar ────────────────────────────────────────

  rl.registerAction("calendar.bookAppointment", { description: "Book a calendar appointment",
    inputSchema: { calendarId: { type: "string", required: true }, locationId: { type: "string", required: true }, contactId: { type: "string", required: true }, startTime: { type: "string", required: true, description: "ISO datetime with timezone offset" }, endTime: { type: "string", required: false }, title: { type: "string", required: false }, appointmentStatus: { type: "string", required: false, description: "new, confirmed, cancelled, showed, noshow, invalid" }, assignedUserId: { type: "string", required: false }, address: { type: "string", required: false }, toNotify: { type: "boolean", required: false } },
    async execute(input, ctx) { const { token } = getConn(ctx); return api(token, "POST", "/calendars/events/appointments", input as Record<string, unknown>); } });

  rl.registerAction("calendar.getFreeSlots", { description: "Get free slots for a calendar",
    inputSchema: { calendarId: { type: "string", required: true }, startDate: { type: "number", required: true, description: "Start date as epoch ms" }, endDate: { type: "number", required: true, description: "End date as epoch ms" }, timezone: { type: "string", required: false }, userId: { type: "string", required: false } },
    async execute(input, ctx) {
      const { token } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { startDate: p.startDate, endDate: p.endDate };
      if (p.timezone) qs.timezone = p.timezone;
      if (p.userId) qs.userId = p.userId;
      return api(token, "GET", `/calendars/${p.calendarId}/free-slots`, undefined, qs);
    } });
}
