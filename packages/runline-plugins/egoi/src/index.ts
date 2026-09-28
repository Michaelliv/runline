import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { egoiCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, egoiCredential, "egoi", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

async function paginate(
  ctx: ActionContext,
  endpoint: string,
  qs: Record<string, unknown> = {},
  limit?: number,
): Promise<unknown[]> {
  const results: unknown[] = [];
  qs.offset = 0;
  qs.count = 500;
  let data: unknown[];
  do {
    const res = (await apiRequest(
      ctx,
      "GET",
      endpoint,
      undefined,
      qs,
    )) as Record<string, unknown>;
    data = (res.items as unknown[]) ?? [];
    results.push(...data);
    (qs.offset as number) += qs.count as number;
    if (limit && results.length >= limit) break;
  } while (data.length > 0);
  return limit ? results.slice(0, limit) : results;
}

export default function egoi(rl: RunlinePluginAPI) {
  rl.setName("egoi");
  rl.setVersion("0.1.0");
  rl.setCredential(egoiCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "E-goi API key",
      env: "EGOI_API_KEY",
    },
  });

  rl.registerAction("contact.create", {
    access: "write",
    description: "Create a contact in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      email: { type: "string", required: true, description: "Email address" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      cellphone: { type: "string", required: false, description: "Cellphone" },
      birthDate: {
        type: "string",
        required: false,
        description: "Birth date (YYYY-MM-DD)",
      },
      status: {
        type: "string",
        required: false,
        description: "Status: active, inactive, unconfirmed, removed",
      },
      tagIds: {
        type: "array",
        required: false,
        description: "Tag IDs to attach",
      },
      extraFields: {
        type: "array",
        required: false,
        description: "Extra fields as [{field_id, value}]",
      },
    },
    async execute(input, ctx) {
      const {
        listId,
        email,
        firstName,
        lastName,
        cellphone,
        birthDate,
        status,
        tagIds,
        extraFields,
      } = input as Record<string, unknown>;
      const base: Record<string, unknown> = { email };
      if (firstName) base.first_name = firstName;
      if (lastName) base.last_name = lastName;
      if (cellphone) base.cellphone = cellphone;
      if (birthDate) base.birth_date = birthDate;
      if (status) base.status = status;
      const body: Record<string, unknown> = { base, extra: extraFields ?? [] };
      const data = (await apiRequest(
        ctx,
        "POST",
        `lists/${pathSegment(listId)}/contacts`,
        body,
      )) as Record<string, unknown>;
      const contactId = data.contact_id;
      if (tagIds && Array.isArray(tagIds)) {
        for (const tag of tagIds) {
          await apiRequest(
            ctx,
            "POST",
            `lists/${pathSegment(listId)}/contacts/actions/attach-tag`,
            {
              tag_id: tag,
              contacts: [contactId],
            },
          );
        }
      }
      return apiRequest(
        ctx,
        "GET",
        `lists/${pathSegment(listId)}/contacts/${pathSegment(contactId)}`,
      );
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID or email",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactId: { type: "string", required: false, description: "Contact ID" },
      email: {
        type: "string",
        required: false,
        description: "Email (alternative to contactId)",
      },
    },
    async execute(input, ctx) {
      const { listId, contactId, email } = (input ?? {}) as Record<
        string,
        unknown
      >;
      if (contactId)
        return apiRequest(
          ctx,
          "GET",
          `lists/${pathSegment(listId)}/contacts/${pathSegment(contactId)}`,
        );
      if (email)
        return apiRequest(
          ctx,
          "GET",
          `lists/${pathSegment(listId)}/contacts`,
          undefined,
          { email: email as string },
        );
      throw new Error("Provide either contactId or email");
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts in a list",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { listId, limit } = (input ?? {}) as Record<string, unknown>;
      return paginate(
        ctx,
        `lists/${pathSegment(listId)}/contacts`,
        {},
        limit as number | undefined,
      );
    },
  });

  rl.registerAction("contact.update", {
    access: "write",
    description: "Update a contact",
    inputSchema: {
      listId: { type: "string", required: true, description: "List ID" },
      contactId: { type: "string", required: true, description: "Contact ID" },
      email: { type: "string", required: false, description: "New email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      cellphone: { type: "string", required: false, description: "Cellphone" },
      birthDate: {
        type: "string",
        required: false,
        description: "Birth date (YYYY-MM-DD)",
      },
      status: { type: "string", required: false, description: "Status" },
      tagIds: {
        type: "array",
        required: false,
        description: "Tag IDs to attach",
      },
      extraFields: {
        type: "array",
        required: false,
        description: "Extra fields as [{field_id, value}]",
      },
    },
    async execute(input, ctx) {
      const {
        listId,
        contactId,
        email,
        firstName,
        lastName,
        cellphone,
        birthDate,
        status,
        tagIds,
        extraFields,
      } = input as Record<string, unknown>;
      const base: Record<string, unknown> = {};
      if (email) base.email = email;
      if (firstName) base.first_name = firstName;
      if (lastName) base.last_name = lastName;
      if (cellphone) base.cellphone = cellphone;
      if (birthDate) base.birth_date = birthDate;
      if (status) base.status = status;
      const body: Record<string, unknown> = { base, extra: extraFields ?? [] };
      await apiRequest(
        ctx,
        "PATCH",
        `lists/${pathSegment(listId)}/contacts/${pathSegment(contactId)}`,
        body,
      );
      if (tagIds && Array.isArray(tagIds)) {
        for (const tag of tagIds) {
          await apiRequest(
            ctx,
            "POST",
            `lists/${pathSegment(listId)}/contacts/actions/attach-tag`,
            {
              tag_id: tag,
              contacts: [contactId],
            },
          );
        }
      }
      return apiRequest(
        ctx,
        "GET",
        `lists/${pathSegment(listId)}/contacts/${pathSegment(contactId)}`,
      );
    },
  });
}
