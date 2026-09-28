import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { dropcontactCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, dropcontactCredential, "dropcontact", {
    target: "api",
    path: endpoint,
    method,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function dropcontact(rl: RunlinePluginAPI) {
  rl.setName("dropcontact");
  rl.setVersion("0.1.0");
  rl.setCredential(dropcontactCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Dropcontact API key",
      env: "DROPCONTACT_API_KEY",
    },
  });

  rl.registerAction("contact.enrich", {
    access: "write",
    description: "Enrich contacts — find B2B emails from name and website",
    inputSchema: {
      contacts: {
        type: "array",
        required: true,
        description:
          "Array of contact objects with fields: email, first_name, last_name, full_name, company, website, phone, linkedin, country, num_siren, siret",
      },
      siren: {
        type: "boolean",
        required: false,
        description: "Include French company SIREN data",
      },
      language: {
        type: "string",
        required: false,
        description: "Response language: en (default) or fr",
      },
    },
    async execute(input, ctx) {
      const { contacts, siren, language } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { data: contacts };
      if (siren) body.siren = true;
      if (language) body.language = language;
      return apiRequest(ctx, "POST", "batch", body);
    },
  });

  rl.registerAction("contact.fetchRequest", {
    access: "read",
    description: "Fetch results of a previous enrich request by ID",
    inputSchema: {
      requestId: {
        type: "string",
        required: true,
        description: "Request ID from a previous enrich call",
      },
    },
    async execute(input, ctx) {
      const { requestId } = input as { requestId: string };
      const data = (await apiRequest(
        ctx,
        "GET",
        `batch/${encodeURIComponent(requestId)}`,
      )) as Record<string, unknown>;
      if (!data.success)
        throw new Error(
          `Request not ready or failed: ${data.reason ?? "unknown"}`,
        );
      return data.data;
    },
  });
}
