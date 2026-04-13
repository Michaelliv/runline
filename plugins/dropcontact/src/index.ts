import type { RunlinePluginAPI } from "runline";

const BASE_URL = "https://api.dropcontact.io";

async function apiRequest(
  apiKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Access-Token": apiKey,
    },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  if (!res.ok) throw new Error(`Dropcontact API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function dropcontact(rl: RunlinePluginAPI) {
  rl.setName("dropcontact");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, description: "Dropcontact API key", env: "DROPCONTACT_API_KEY" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  rl.registerAction("contact.enrich", {
    description: "Enrich contacts — find B2B emails from name and website",
    inputSchema: {
      contacts: {
        type: "array",
        required: true,
        description: "Array of contact objects with fields: email, first_name, last_name, full_name, company, website, phone, linkedin, country, num_siren, siret",
      },
      siren: { type: "boolean", required: false, description: "Include French company SIREN data" },
      language: { type: "string", required: false, description: "Response language: en (default) or fr" },
    },
    async execute(input, ctx) {
      const { contacts, siren, language } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { data: contacts };
      if (siren) body.siren = true;
      if (language) body.language = language;
      return apiRequest(key(ctx), "POST", "/batch", body);
    },
  });

  rl.registerAction("contact.fetchRequest", {
    description: "Fetch results of a previous enrich request by ID",
    inputSchema: {
      requestId: { type: "string", required: true, description: "Request ID from a previous enrich call" },
    },
    async execute(input, ctx) {
      const { requestId } = input as { requestId: string };
      const data = (await apiRequest(key(ctx), "GET", `/batch/${requestId}`)) as Record<string, unknown>;
      if (!data.success) throw new Error(`Request not ready or failed: ${data.reason ?? "unknown"}`);
      return data.data;
    },
  });
}
