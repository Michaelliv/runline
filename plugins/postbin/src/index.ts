import type { RunlinePluginAPI } from "runline";

const BASE = "https://www.postb.in";

async function apiRequest(method: string, path: string, body?: string): Promise<unknown> {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = body;
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`PostBin error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function parseBinId(binId: string): string {
  const match = /\b\d{13}-\d{13}\b/.exec(binId);
  if (!match) throw new Error(`Invalid Bin ID format: ${binId}`);
  return match[0];
}

function transformBin(data: Record<string, unknown>): Record<string, unknown> {
  const binId = data.binId as string;
  return {
    binId,
    nowTimestamp: data.now,
    nowIso: new Date(data.now as string).toISOString(),
    expiresTimestamp: data.expires,
    expiresIso: new Date(data.expires as string).toISOString(),
    requestUrl: `${BASE}/${binId}`,
    viewUrl: `${BASE}/b/${binId}`,
  };
}

export default function postbin(rl: RunlinePluginAPI) {
  rl.setName("postbin");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({});

  rl.registerAction("bin.create", {
    description: "Create a new PostBin bin (no auth required)",
    inputSchema: {},
    async execute() {
      const data = (await apiRequest("POST", "/api/bin")) as Record<string, unknown>;
      return transformBin(data);
    },
  });

  rl.registerAction("bin.get", {
    description: "Get a bin's info",
    inputSchema: { binId: { type: "string", required: true } },
    async execute(input) {
      const id = parseBinId((input as Record<string, unknown>).binId as string);
      const data = (await apiRequest("GET", `/api/bin/${id}`)) as Record<string, unknown>;
      return transformBin(data);
    },
  });

  rl.registerAction("bin.delete", {
    description: "Delete a bin",
    inputSchema: { binId: { type: "string", required: true } },
    async execute(input) {
      const id = parseBinId((input as Record<string, unknown>).binId as string);
      await apiRequest("DELETE", `/api/bin/${id}`);
      return { success: true };
    },
  });

  rl.registerAction("request.get", {
    description: "Get a specific request from a bin",
    inputSchema: {
      binId: { type: "string", required: true },
      requestId: { type: "string", required: true },
    },
    async execute(input) {
      const p = input as Record<string, unknown>;
      const id = parseBinId(p.binId as string);
      return apiRequest("GET", `/api/bin/${id}/req/${p.requestId}`);
    },
  });

  rl.registerAction("request.removeFirst", {
    description: "Remove and return the first request from a bin",
    inputSchema: { binId: { type: "string", required: true } },
    async execute(input) {
      const id = parseBinId((input as Record<string, unknown>).binId as string);
      return apiRequest("GET", `/api/bin/${id}/req/shift`);
    },
  });

  rl.registerAction("request.send", {
    description: "Send a test request to a bin",
    inputSchema: {
      binId: { type: "string", required: true },
      content: { type: "string", required: false, description: "Request body content" },
    },
    async execute(input) {
      const p = input as Record<string, unknown>;
      const id = parseBinId(p.binId as string);
      const data = await apiRequest("POST", `/${id}`, p.content ? JSON.stringify({ content: p.content }) : undefined);
      return { requestId: data };
    },
  });
}
