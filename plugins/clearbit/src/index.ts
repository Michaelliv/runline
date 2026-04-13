import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  apiKey: string,
  subdomain: string,
  endpoint: string,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`https://${subdomain}.clearbit.com${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clearbit API error ${res.status}: ${text}`);
  }
  return res.json();
}

function getKey(ctx: { connection: { config: Record<string, unknown> } }): string {
  return ctx.connection.config.apiKey as string;
}

export default function clearbit(rl: RunlinePluginAPI) {
  rl.setName("clearbit");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Clearbit API key",
      env: "CLEARBIT_API_KEY",
    },
  });

  rl.registerAction("person.enrich", {
    description: "Look up a person by email address",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      givenName: { type: "string", required: false, description: "First name hint" },
      familyName: { type: "string", required: false, description: "Last name hint" },
      ipAddress: { type: "string", required: false, description: "IP address hint" },
      location: { type: "string", required: false, description: "Location hint" },
      company: { type: "string", required: false, description: "Company name hint" },
      companyDomain: { type: "string", required: false, description: "Company domain hint" },
      linkedin: { type: "string", required: false, description: "LinkedIn URL hint" },
      twitter: { type: "string", required: false, description: "Twitter handle hint" },
      facebook: { type: "string", required: false, description: "Facebook URL hint" },
    },
    async execute(input, ctx) {
      const { email, givenName, familyName, ipAddress, location, company, companyDomain, linkedin, twitter, facebook } =
        (input ?? {}) as Record<string, unknown>;
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
      return apiRequest(getKey(ctx), "person-stream", "/v2/people/find", qs);
    },
  });

  rl.registerAction("company.enrich", {
    description: "Look up a company by domain",
    inputSchema: {
      domain: { type: "string", required: true, description: "Company domain" },
      companyName: { type: "string", required: false, description: "Company name hint" },
      linkedin: { type: "string", required: false, description: "LinkedIn URL hint" },
      twitter: { type: "string", required: false, description: "Twitter handle hint" },
      facebook: { type: "string", required: false, description: "Facebook URL hint" },
    },
    async execute(input, ctx) {
      const { domain, companyName, linkedin, twitter, facebook } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { domain };
      if (companyName) qs.company_name = companyName;
      if (linkedin) qs.linkedin = linkedin;
      if (twitter) qs.twitter = twitter;
      if (facebook) qs.facebook = facebook;
      return apiRequest(getKey(ctx), "company-stream", "/v2/companies/find", qs);
    },
  });

  rl.registerAction("company.autocomplete", {
    description: "Autocomplete company names",
    inputSchema: {
      name: { type: "string", required: true, description: "Partial company name" },
    },
    async execute(input, ctx) {
      const { name } = input as { name: string };
      return apiRequest(getKey(ctx), "autocomplete", "/v1/companies/suggest", { query: name });
    },
  });
}
