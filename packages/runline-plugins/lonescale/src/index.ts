import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { lonescaleCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, lonescaleCredential, "lonescale", {
    target: "api",
    path,
    method,
    query,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

export default function lonescale(rl: RunlinePluginAPI) {
  rl.setName("lonescale");
  rl.setVersion("0.1.0");
  rl.setCredential(lonescaleCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "LoneScale API key",
      env: "LONESCALE_API_KEY",
    },
  });

  rl.registerAction("list.create", {
    access: "write",
    description: "Create a new list",
    inputSchema: {
      name: { type: "string", required: true, description: "List name" },
      entity: {
        type: "string",
        required: true,
        description: "PEOPLE or COMPANY",
      },
    },
    async execute(input, ctx) {
      const { name, entity } = input as Record<string, unknown>;
      return apiRequest(ctx, "POST", "lists", { name, entity });
    },
  });

  rl.registerAction("list.list", {
    access: "read",
    description: "List all lists, optionally filtered by entity type",
    inputSchema: {
      entity: {
        type: "string",
        required: false,
        description: "PEOPLE or COMPANY",
      },
    },
    async execute(input, ctx) {
      const { entity } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (entity) qs.entity = entity;
      return apiRequest(ctx, "GET", "lists", undefined, qs);
    },
  });

  rl.registerAction("item.addPerson", {
    access: "write",
    description: "Add a person (contact) to a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      fullName: { type: "string", required: false },
      email: { type: "string", required: false },
      companyName: { type: "string", required: false },
      currentPosition: { type: "string", required: false },
      domain: {
        type: "string",
        required: false,
        description: "Company domain",
      },
      linkedinUrl: { type: "string", required: false },
      location: { type: "string", required: false },
      contactId: {
        type: "string",
        required: false,
        description: "Contact ID from your source",
      },
    },
    async execute(input, ctx) {
      const {
        listId,
        firstName,
        lastName,
        fullName,
        email,
        companyName,
        currentPosition,
        domain,
        linkedinUrl,
        location,
        contactId,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (firstName) body.first_name = firstName;
      if (lastName) body.last_name = lastName;
      if (fullName) body.full_name = fullName;
      if (email) body.email = email;
      if (companyName) body.company_name = companyName;
      if (currentPosition) body.current_position = currentPosition;
      if (domain) body.domain = domain;
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      if (location) body.location = location;
      if (contactId) body.contact_id = contactId;
      return apiRequest(ctx, "POST", `lists/${seg(listId)}/item`, body);
    },
  });

  rl.registerAction("item.addCompany", {
    access: "write",
    description: "Add a company to a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      companyName: { type: "string", required: true },
      linkedinUrl: { type: "string", required: false },
      domain: {
        type: "string",
        required: false,
        description: "Company domain",
      },
      location: { type: "string", required: false },
      contactId: {
        type: "string",
        required: false,
        description: "Contact ID from your source",
      },
    },
    async execute(input, ctx) {
      const { listId, companyName, linkedinUrl, domain, location, contactId } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (companyName) body.company_name = companyName;
      if (linkedinUrl) body.linkedin_url = linkedinUrl;
      if (domain) body.domain = domain;
      if (location) body.location = location;
      if (contactId) body.contact_id = contactId;
      return apiRequest(ctx, "POST", `lists/${seg(listId)}/item`, body);
    },
  });
}
