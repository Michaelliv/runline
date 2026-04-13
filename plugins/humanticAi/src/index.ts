import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.humantic.ai/v1";

async function apiRequest(apiKey: string, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("apikey", apiKey);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0 && method !== "GET") opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok) throw new Error(`Humantic AI error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function humanticAi(rl: RunlinePluginAPI) {
  rl.setName("humanticAi");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "Humantic AI API key", env: "HUMANTIC_AI_API_KEY" } });

  rl.registerAction("profile.create", {
    description: "Create a user profile from LinkedIn URL or text",
    inputSchema: { userId: { type: "string", required: true, description: "Unique user identifier" }, linkedinUrl: { type: "string", required: false, description: "LinkedIn profile URL" }, text: { type: "string", required: false, description: "Text content to analyze" } },
    async execute(input, ctx) {
      const { userId, linkedinUrl, text } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { userid: userId };
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      if (text) body.text = text;
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/user-profile/create", body);
    },
  });

  rl.registerAction("profile.get", {
    description: "Get a user profile/personality analysis",
    inputSchema: { userId: { type: "string", required: true, description: "User identifier" }, persona: { type: "string", required: false, description: "Persona type: sales, hiring, default" } },
    async execute(input, ctx) {
      const { userId, persona } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { userid: userId };
      if (persona) qs.persona = persona;
      return apiRequest(ctx.connection.config.apiKey as string, "GET", "/user-profile", undefined, qs);
    },
  });

  rl.registerAction("profile.update", {
    description: "Update a user profile with new data",
    inputSchema: { userId: { type: "string", required: true, description: "User identifier" }, text: { type: "string", required: false, description: "Additional text" }, linkedinUrl: { type: "string", required: false, description: "LinkedIn URL" } },
    async execute(input, ctx) {
      const { userId, text, linkedinUrl } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { userid: userId };
      if (text) body.text = text;
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      return apiRequest(ctx.connection.config.apiKey as string, "POST", "/user-profile/create", body);
    },
  });
}
