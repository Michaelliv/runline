import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api-ssl.bitly.com/v4";

async function apiRequest(
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bitly API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getToken(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.accessToken as string;
}

export default function bitly(rl: RunlinePluginAPI) {
  rl.setName("bitly");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Bitly access token",
      env: "BITLY_ACCESS_TOKEN",
    },
  });

  rl.registerAction("link.create", {
    description: "Create a shortened link (bitlink)",
    inputSchema: {
      longUrl: { type: "string", required: true, description: "Long URL to shorten" },
      title: { type: "string", required: false, description: "Title for the link" },
      domain: { type: "string", required: false, description: "Custom domain (default: bit.ly)" },
      group: { type: "string", required: false, description: "Group GUID" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
      deeplinks: {
        type: "array",
        required: false,
        description: "Array of {app_uri_path, install_type, install_url, app_id}",
      },
    },
    async execute(input, ctx) {
      const { longUrl, title, domain, group, tags, deeplinks } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { long_url: longUrl };
      if (title) body.title = title;
      if (domain) body.domain = domain;
      if (group) body.group = group;
      if (tags) body.tags = tags;
      if (deeplinks) body.deeplinks = deeplinks;
      return apiRequest(getToken(ctx), "POST", "/bitlinks", body);
    },
  });

  rl.registerAction("link.get", {
    description: "Get a bitlink by ID",
    inputSchema: {
      bitlink: { type: "string", required: true, description: "Bitlink (e.g. bit.ly/22u3ypK)" },
    },
    async execute(input, ctx) {
      const { bitlink } = input as { bitlink: string };
      return apiRequest(getToken(ctx), "GET", `/bitlinks/${bitlink}`);
    },
  });

  rl.registerAction("link.update", {
    description: "Update a bitlink",
    inputSchema: {
      bitlink: { type: "string", required: true, description: "Bitlink (e.g. bit.ly/22u3ypK)" },
      longUrl: { type: "string", required: false, description: "New long URL" },
      title: { type: "string", required: false, description: "New title" },
      archived: { type: "boolean", required: false, description: "Archive the link" },
      group: { type: "string", required: false, description: "Group GUID" },
      tags: { type: "array", required: false, description: "Array of tag strings" },
      deeplinks: {
        type: "array",
        required: false,
        description: "Array of {app_uri_path, install_type, install_url, app_id}",
      },
    },
    async execute(input, ctx) {
      const { bitlink, longUrl, title, archived, group, tags, deeplinks } = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (longUrl) body.long_url = longUrl;
      if (title) body.title = title;
      if (archived !== undefined) body.archived = archived;
      if (group) body.group = group;
      if (tags) body.tags = tags;
      if (deeplinks) body.deeplinks = deeplinks;
      return apiRequest(getToken(ctx), "PATCH", `/bitlinks/${bitlink}`, body);
    },
  });
}
