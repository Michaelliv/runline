import type { ActionContext, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { clearbitCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  target: "person" | "company" | "autocomplete",
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, clearbitCredential, "clearbit", {
    target,
    path: endpoint,
    query: qs,
  });
}

export default function clearbit(rl: RunlinePluginAPI) {
  rl.setName("clearbit");
  rl.setVersion("0.1.0");
  rl.setCredential(clearbitCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Clearbit API key",
      env: "CLEARBIT_API_KEY",
    },
  });

  rl.registerAction("person.enrich", {
    access: "read",
    description: "Look up a person by email address",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      givenName: {
        type: "string",
        required: false,
        description: "First name hint",
      },
      familyName: {
        type: "string",
        required: false,
        description: "Last name hint",
      },
      ipAddress: {
        type: "string",
        required: false,
        description: "IP address hint",
      },
      location: {
        type: "string",
        required: false,
        description: "Location hint",
      },
      company: {
        type: "string",
        required: false,
        description: "Company name hint",
      },
      companyDomain: {
        type: "string",
        required: false,
        description: "Company domain hint",
      },
      linkedin: {
        type: "string",
        required: false,
        description: "LinkedIn URL hint",
      },
      twitter: {
        type: "string",
        required: false,
        description: "Twitter handle hint",
      },
      facebook: {
        type: "string",
        required: false,
        description: "Facebook URL hint",
      },
    },
    async execute(input, ctx) {
      const {
        email,
        givenName,
        familyName,
        ipAddress,
        location,
        company,
        companyDomain,
        linkedin,
        twitter,
        facebook,
      } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { email };
      if (givenName) qs.given_name = givenName;
      if (familyName) qs.family_name = familyName;
      if (ipAddress) qs.ip_address = ipAddress;
      if (location) qs.location = location;
      if (company) qs.company = company;
      if (companyDomain) qs.company_domain = companyDomain;
      if (linkedin) qs.linkedin = linkedin;
      if (twitter) qs.twitter = twitter;
      if (facebook) qs.facebook = facebook;
      return apiRequest(ctx, "person", "people/find", qs);
    },
  });

  rl.registerAction("company.enrich", {
    access: "read",
    description: "Look up a company by domain",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
      companyName: {
        type: "string",
        required: false,
        description: "Company name hint",
      },
      linkedin: {
        type: "string",
        required: false,
        description: "LinkedIn URL hint",
      },
      twitter: {
        type: "string",
        required: false,
        description: "Twitter handle hint",
      },
      facebook: {
        type: "string",
        required: false,
        description: "Facebook URL hint",
      },
    },
    async execute(input, ctx) {
      const { domain, companyName, linkedin, twitter, facebook } = (input ??
        {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { domain };
      if (companyName) qs.company_name = companyName;
      if (linkedin) qs.linkedin = linkedin;
      if (twitter) qs.twitter = twitter;
      if (facebook) qs.facebook = facebook;
      return apiRequest(ctx, "company", "companies/find", qs);
    },
  });

  rl.registerAction("company.autocomplete", {
    access: "read",
    description: "Autocomplete company names",
    inputSchema: {
      name: {
        type: "string",
        required: true,
        description: "Partial company name",
      },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      return apiRequest(ctx, "autocomplete", "companies/suggest", {
        query: name,
      });
    },
  });
}
