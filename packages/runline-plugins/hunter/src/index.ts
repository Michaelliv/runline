import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { hunterCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  path: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, hunterCredential, "hunter", {
    target: "api",
    path,
    query: qs,
  });
}

export default function hunter(rl: RunlinePluginAPI) {
  rl.setName("hunter");
  rl.setVersion("0.1.0");
  rl.setCredential(hunterCredential);
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
      const data = (await apiRequest(ctx, "domain-search", qs)) as Record<
        string,
        unknown
      >;
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
      const data = (await apiRequest(ctx, "email-finder", {
        domain,
        first_name: firstName,
        last_name: lastName,
      })) as Record<string, unknown>;
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
      const data = (await apiRequest(ctx, "email-verifier", {
        email: (input as { email: string }).email,
      })) as Record<string, unknown>;
      return data.data;
    },
  });
}
