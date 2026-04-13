import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  baseUrl: string, apiKey: string, method: string, endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: { Authorization: apiKey, Accept: "application/json", "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${endpoint}`, opts);
  if (!res.ok) throw new Error(`MISP API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function misp(rl: RunlinePluginAPI) {
  rl.setName("misp");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    baseUrl: { type: "string", required: true, description: "MISP instance URL", env: "MISP_URL" },
    apiKey: { type: "string", required: true, description: "MISP API key (Authorization header)", env: "MISP_API_KEY" },
  });

  const conn = (ctx: { connection: { config: Record<string, unknown> } }) => ({
    baseUrl: (ctx.connection.config.baseUrl as string).replace(/\/$/, ""),
    apiKey: ctx.connection.config.apiKey as string,
  });

  const req = (ctx: { connection: { config: Record<string, unknown> } }, method: string, ep: string, body?: Record<string, unknown>) => {
    const c = conn(ctx);
    return apiRequest(c.baseUrl, c.apiKey, method, ep, body);
  };

  // ── Attribute ───────────────────────────────────────

  rl.registerAction("attribute.create", {
    description: "Add an attribute to an event",
    inputSchema: {
      eventId: { type: "string", required: true },
      type: { type: "string", required: true, description: "Attribute type (ip-src, domain, md5, etc.)" },
      value: { type: "string", required: true },
      additionalFields: { type: "object", required: false, description: "category, comment, to_ids, distribution, sharing_group_id, etc." },
    },
    async execute(input, ctx) {
      const { eventId, type, value, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { type, value };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", `/attributes/add/${eventId}`, body)) as Record<string, unknown>;
      return data.Attribute;
    },
  });

  rl.registerAction("attribute.get", {
    description: "Get an attribute by ID",
    inputSchema: { attributeId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/attributes/view/${(input as { attributeId: string }).attributeId}`)) as Record<string, unknown>;
      return data.Attribute;
    },
  });

  rl.registerAction("attribute.list", {
    description: "List all attributes",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/attributes")) as unknown[];
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("attribute.search", {
    description: "Search attributes via restSearch",
    inputSchema: {
      value: { type: "string", required: false },
      searchBody: { type: "object", required: false, description: "Full search body (value, type, category, tags, etc.)" },
    },
    async execute(input, ctx) {
      const { value, searchBody } = (input ?? {}) as Record<string, unknown>;
      const body = (searchBody as Record<string, unknown>) ?? {};
      if (value) body.value = value;
      const data = (await req(ctx, "POST", "/attributes/restSearch", body)) as Record<string, unknown>;
      return (data.response as Record<string, unknown>)?.Attribute ?? [];
    },
  });

  rl.registerAction("attribute.update", {
    description: "Update an attribute",
    inputSchema: { attributeId: { type: "string", required: true }, updateFields: { type: "object", required: true } },
    async execute(input, ctx) {
      const { attributeId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PUT", `/attributes/edit/${attributeId}`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.Attribute;
    },
  });

  rl.registerAction("attribute.delete", {
    description: "Delete an attribute",
    inputSchema: { attributeId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "DELETE", `/attributes/delete/${(input as { attributeId: string }).attributeId}`); },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.create", {
    description: "Create an event",
    inputSchema: {
      orgId: { type: "string", required: true, description: "Organisation ID" },
      info: { type: "string", required: true, description: "Event description/info" },
      additionalFields: { type: "object", required: false, description: "distribution, threat_level_id, analysis, date, etc." },
    },
    async execute(input, ctx) {
      const { orgId, info, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { org_id: orgId, info };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/events", body)) as Record<string, unknown>;
      return data.Event;
    },
  });

  rl.registerAction("event.get", {
    description: "Get an event by ID",
    inputSchema: { eventId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/events/view/${(input as { eventId: string }).eventId}`)) as Record<string, unknown>;
      const event = data.Event as Record<string, unknown>;
      delete event.Attribute; // prevent excessive payload
      return event;
    },
  });

  rl.registerAction("event.list", {
    description: "List all events",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/events")) as unknown[];
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("event.search", {
    description: "Search events via restSearch",
    inputSchema: {
      value: { type: "string", required: false },
      searchBody: { type: "object", required: false, description: "Full search body" },
    },
    async execute(input, ctx) {
      const { value, searchBody } = (input ?? {}) as Record<string, unknown>;
      const body = (searchBody as Record<string, unknown>) ?? {};
      if (value) body.value = value;
      const data = (await req(ctx, "POST", "/events/restSearch", body)) as Record<string, unknown>;
      const response = data.response as Array<Record<string, unknown>> | undefined;
      return response?.map((e) => e.Event) ?? [];
    },
  });

  rl.registerAction("event.update", {
    description: "Update an event",
    inputSchema: { eventId: { type: "string", required: true }, updateFields: { type: "object", required: true } },
    async execute(input, ctx) {
      const { eventId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PUT", `/events/edit/${eventId}`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      const event = data.Event as Record<string, unknown>;
      delete event.Attribute;
      return event;
    },
  });

  rl.registerAction("event.publish", {
    description: "Publish an event",
    inputSchema: { eventId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "POST", `/events/publish/${(input as { eventId: string }).eventId}`); },
  });

  rl.registerAction("event.unpublish", {
    description: "Unpublish an event",
    inputSchema: { eventId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "POST", `/events/unpublish/${(input as { eventId: string }).eventId}`); },
  });

  rl.registerAction("event.delete", {
    description: "Delete an event",
    inputSchema: { eventId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "DELETE", `/events/delete/${(input as { eventId: string }).eventId}`); },
  });

  // ── Event Tag ───────────────────────────────────────

  rl.registerAction("eventTag.add", {
    description: "Add a tag to an event",
    inputSchema: { eventId: { type: "string", required: true }, tagId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { eventId, tagId } = input as Record<string, unknown>;
      return req(ctx, "POST", "/events/addTag", { event: eventId, tag: tagId });
    },
  });

  rl.registerAction("eventTag.remove", {
    description: "Remove a tag from an event",
    inputSchema: { eventId: { type: "string", required: true }, tagId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { eventId, tagId } = input as Record<string, unknown>;
      return req(ctx, "POST", `/events/removeTag/${eventId}/${tagId}`);
    },
  });

  // ── Feed ────────────────────────────────────────────

  rl.registerAction("feed.create", {
    description: "Create a feed",
    inputSchema: {
      name: { type: "string", required: true },
      provider: { type: "string", required: true },
      url: { type: "string", required: true },
      additionalFields: { type: "object", required: false, description: "input_source, source_format, enabled, distribution, etc." },
    },
    async execute(input, ctx) {
      const { name, provider, url, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name, provider, url };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/feeds/add", body)) as Record<string, unknown>;
      return data.Feed;
    },
  });

  rl.registerAction("feed.get", {
    description: "Get a feed by ID",
    inputSchema: { feedId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/feeds/view/${(input as { feedId: string }).feedId}`)) as Record<string, unknown>;
      return data.Feed;
    },
  });

  rl.registerAction("feed.list", {
    description: "List all feeds",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/feeds")) as Array<Record<string, unknown>>;
      data = data.map((e) => e.Feed as Record<string, unknown>);
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("feed.update", {
    description: "Update a feed",
    inputSchema: { feedId: { type: "string", required: true }, updateFields: { type: "object", required: true } },
    async execute(input, ctx) {
      const { feedId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PUT", `/feeds/edit/${feedId}`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.Feed;
    },
  });

  rl.registerAction("feed.enable", {
    description: "Enable a feed",
    inputSchema: { feedId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "POST", `/feeds/enable/${(input as { feedId: string }).feedId}`); },
  });

  rl.registerAction("feed.disable", {
    description: "Disable a feed",
    inputSchema: { feedId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "POST", `/feeds/disable/${(input as { feedId: string }).feedId}`); },
  });

  // ── Galaxy ──────────────────────────────────────────

  rl.registerAction("galaxy.get", {
    description: "Get a galaxy by ID",
    inputSchema: { galaxyId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/galaxies/view/${(input as { galaxyId: string }).galaxyId}`)) as Record<string, unknown>;
      return data.Galaxy;
    },
  });

  rl.registerAction("galaxy.list", {
    description: "List all galaxies",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/galaxies")) as Array<Record<string, unknown>>;
      data = data.map((e) => e.Galaxy as Record<string, unknown>);
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("galaxy.delete", {
    description: "Delete a galaxy",
    inputSchema: { galaxyId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "DELETE", `/galaxies/delete/${(input as { galaxyId: string }).galaxyId}`); },
  });

  // ── Noticelist ──────────────────────────────────────

  rl.registerAction("noticelist.get", {
    description: "Get a noticelist by ID",
    inputSchema: { noticelistId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/noticelists/view/${(input as { noticelistId: string }).noticelistId}`)) as Record<string, unknown>;
      return data.Noticelist;
    },
  });

  rl.registerAction("noticelist.list", {
    description: "List all noticelists",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/noticelists")) as Array<Record<string, unknown>>;
      data = data.map((e) => e.Noticelist as Record<string, unknown>);
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  // ── Object ──────────────────────────────────────────

  rl.registerAction("object.search", {
    description: "Search objects via restSearch",
    inputSchema: {
      value: { type: "string", required: false },
      searchBody: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { value, searchBody } = (input ?? {}) as Record<string, unknown>;
      const body = (searchBody as Record<string, unknown>) ?? {};
      if (value) body.value = value;
      const data = (await req(ctx, "POST", "/objects/restSearch", body)) as Record<string, unknown>;
      const response = data.response as Array<Record<string, unknown>> | undefined;
      return response?.map((o) => o.Object) ?? [];
    },
  });

  // ── Organisation ────────────────────────────────────

  rl.registerAction("organisation.create", {
    description: "Create an organisation",
    inputSchema: {
      name: { type: "string", required: true },
      additionalFields: { type: "object", required: false, description: "description, type, nationality, sector, contacts, uuid, local" },
    },
    async execute(input, ctx) {
      const { name, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/admin/organisations/add", body)) as Record<string, unknown>;
      return data.Organisation;
    },
  });

  rl.registerAction("organisation.get", {
    description: "Get an organisation by ID",
    inputSchema: { organisationId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/organisations/view/${(input as { organisationId: string }).organisationId}`)) as Record<string, unknown>;
      return data.Organisation;
    },
  });

  rl.registerAction("organisation.list", {
    description: "List all organisations",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/organisations")) as Array<Record<string, unknown>>;
      data = data.map((e) => e.Organisation as Record<string, unknown>);
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("organisation.update", {
    description: "Update an organisation",
    inputSchema: { organisationId: { type: "string", required: true }, updateFields: { type: "object", required: true } },
    async execute(input, ctx) {
      const { organisationId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PUT", `/admin/organisations/edit/${organisationId}`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.Organisation;
    },
  });

  rl.registerAction("organisation.delete", {
    description: "Delete an organisation",
    inputSchema: { organisationId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "DELETE", `/admin/organisations/delete/${(input as { organisationId: string }).organisationId}`); },
  });

  // ── Tag ─────────────────────────────────────────────

  rl.registerAction("tag.create", {
    description: "Create a tag",
    inputSchema: {
      name: { type: "string", required: true },
      colour: { type: "string", required: false, description: "Hex colour (e.g. #ff0000)" },
    },
    async execute(input, ctx) {
      const { name, colour } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { name };
      if (colour) body.colour = (colour as string).startsWith("#") ? colour : `#${colour}`;
      const data = (await req(ctx, "POST", "/tags/add", body)) as Record<string, unknown>;
      return data.Tag;
    },
  });

  rl.registerAction("tag.list", {
    description: "List all tags",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", "/tags")) as Record<string, unknown>;
      let tags = data.Tag as unknown[];
      if ((input as Record<string, unknown>)?.limit) tags = tags.slice(0, (input as Record<string, unknown>).limit as number);
      return tags;
    },
  });

  rl.registerAction("tag.update", {
    description: "Update a tag",
    inputSchema: {
      tagId: { type: "string", required: true },
      name: { type: "string", required: false },
      colour: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { tagId, name, colour } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (name) body.name = name;
      if (colour) body.colour = (colour as string).startsWith("#") ? colour : `#${colour}`;
      const data = (await req(ctx, "POST", `/tags/edit/${tagId}`, body)) as Record<string, unknown>;
      return data.Tag;
    },
  });

  rl.registerAction("tag.delete", {
    description: "Delete a tag",
    inputSchema: { tagId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "POST", `/tags/delete/${(input as { tagId: string }).tagId}`); },
  });

  // ── User ────────────────────────────────────────────

  rl.registerAction("user.create", {
    description: "Create a user",
    inputSchema: {
      email: { type: "string", required: true },
      roleId: { type: "string", required: true, description: "Role ID" },
      additionalFields: { type: "object", required: false, description: "org_id, password, termsaccepted, change_pw, etc." },
    },
    async execute(input, ctx) {
      const { email, roleId, additionalFields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email, role_id: roleId };
      if (additionalFields) Object.assign(body, additionalFields);
      const data = (await req(ctx, "POST", "/admin/users/add", body)) as Record<string, unknown>;
      return data.User;
    },
  });

  rl.registerAction("user.get", {
    description: "Get a user by ID",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/admin/users/view/${(input as { userId: string }).userId}`)) as Record<string, unknown>;
      return data.User;
    },
  });

  rl.registerAction("user.list", {
    description: "List all users",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      let data = (await req(ctx, "GET", "/admin/users")) as Array<Record<string, unknown>>;
      data = data.map((e) => e.User as Record<string, unknown>);
      if ((input as Record<string, unknown>)?.limit) data = data.slice(0, (input as Record<string, unknown>).limit as number);
      return data;
    },
  });

  rl.registerAction("user.update", {
    description: "Update a user",
    inputSchema: { userId: { type: "string", required: true }, updateFields: { type: "object", required: true } },
    async execute(input, ctx) {
      const { userId, updateFields } = input as Record<string, unknown>;
      const data = (await req(ctx, "PUT", `/admin/users/edit/${userId}`, updateFields as Record<string, unknown>)) as Record<string, unknown>;
      return data.User;
    },
  });

  rl.registerAction("user.delete", {
    description: "Delete a user",
    inputSchema: { userId: { type: "string", required: true } },
    async execute(input, ctx) { return req(ctx, "DELETE", `/admin/users/delete/${(input as { userId: string }).userId}`); },
  });

  // ── Warninglist ─────────────────────────────────────

  rl.registerAction("warninglist.get", {
    description: "Get a warninglist by ID",
    inputSchema: { warninglistId: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", `/warninglists/view/${(input as { warninglistId: string }).warninglistId}`)) as Record<string, unknown>;
      return data.Warninglist;
    },
  });

  rl.registerAction("warninglist.list", {
    description: "List all warninglists",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const data = (await req(ctx, "GET", "/warninglists")) as Record<string, unknown>;
      let lists = ((data.Warninglists as Array<Record<string, unknown>>) ?? []).map((e) => e.Warninglist);
      if ((input as Record<string, unknown>)?.limit) lists = lists.slice(0, (input as Record<string, unknown>).limit as number);
      return lists;
    },
  });
}
