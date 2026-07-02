import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.hunter.io/v2";

async function apiRequest(
  apiKey: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set("api_key", apiKey);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok)
    throw new Error(`Hunter API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function hunter(rl: RunlinePluginAPI) {
  rl.setName("hunter");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Hunter.io API key",
      env: "HUNTER_API_KEY",
    },
  });

  rl.registerAction("domainSearch", {
    access: "read",
    description: "Search for email addresses associated with a domain",
    inputSchema: {
      domain: {
        type: "string",
        required: true,
        description: "Domain name (e.g. example.com)",
      },
      type: {
        type: "string",
        required: false,
        description: "personal or generic",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { domain, type, limit } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { domain };
      if (type) qs.type = type;
      if (limit) qs.limit = limit;
      const data = (await apiRequest(
        ctx.connection.config.apiKey as string,
        "/domain-search",
        qs,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("emailFinder", {
    access: "read",
    description: "Find the email address of a person",
    inputSchema: {
      domain: { type: "string", required: true, description: "Domain" },
      firstName: { type: "string", required: true, description: "First name" },
      lastName: { type: "string", required: true, description: "Last name" },
    },
    async execute(input, ctx) {
      const { domain, firstName, lastName } = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx.connection.config.apiKey as string,
        "/email-finder",
        { domain, first_name: firstName, last_name: lastName },
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction("emailVerifier", {
    access: "read",
    description: "Verify an email address",
    inputSchema: {
      email: { type: "string", required: true, description: "Email to verify" },
    },
    async execute(input, ctx) {
      const data = (await apiRequest(
        ctx.connection.config.apiKey as string,
        "/email-verifier",
        { email: (input as { email: string }).email },
      )) as Record<string, unknown>;
      return data.data;
    },
  });
}
