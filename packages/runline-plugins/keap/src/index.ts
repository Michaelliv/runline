import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { keapCredential } from "./credentials.js";

function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, keapCredential, "keap", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

export default function keap(rl: RunlinePluginAPI) {
  rl.setName("keap");
  rl.setVersion("0.1.0");
  rl.setCredential(keapCredential);

  rl.setConnectionSchema({
    accessToken: {
      type: "string",
      required: true,
      description: "Keap OAuth2 access token",
      env: "KEAP_ACCESS_TOKEN",
    },
  });

  // ── Company ─────────────────────────────────────────
  rl.registerAction("company.create", {
    access: "write",
    description: "Create a company",
    inputSchema: {
      companyName: {
        type: "string",
        required: true,
        description: "Company name",
      },
      address: {
        type: "object",
        required: false,
        description:
          "Address object (line1, line2, locality, region, zip_code, country_code)",
      },
      phone: {
        type: "object",
        required: false,
        description: "Phone object (number, field, type)",
      },
      fax: {
        type: "object",
        required: false,
        description: "Fax object (number, type)",
      },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "Additional company fields (email_address, website, notes, etc.)",
      },
    },
    async execute(input, ctx) {
      const { companyName, address, phone, fax, additionalFields } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = { company_name: companyName };
      if (additionalFields) Object.assign(body, additionalFields);
      if (address) body.address = address;
      if (phone) body.phone_number = phone;
      if (fax) body.fax_number = fax;
      return apiRequest(ctx, "POST", "companies", body);
    },
  });

  rl.registerAction("company.list", {
    access: "read",
    description: "List companies",
    inputSchema: {
      limit: {
        type: "number",
        required: false,
        description: "Max results (default 50)",
      },
      offset: { type: "number", required: false },
      optionalProperties: {
        type: "string",
        required: false,
        description: "Comma-separated optional fields to include",
      },
    },
    async execute(input, ctx) {
      const { limit, offset, optionalProperties } = (input ?? {}) as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      if (offset) qs.offset = offset;
      if (optionalProperties) qs.optional_properties = optionalProperties;
      const data = (await apiRequest(
        ctx,
        "GET",
        "companies",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.companies;
    },
  });

  // ── Contact ─────────────────────────────────────────
  rl.registerAction("contact.upsert", {
    access: "write",
    description:
      "Create or update a contact (PUT). Duplicate matching is controlled by duplicate_option.",
    inputSchema: {
      duplicateOption: {
        type: "string",
        required: true,
        description:
          "How to handle duplicates: 'Email', 'EmailAndName', 'EmailAndNameAndCompany'",
      },
      emailAddresses: {
        type: "array",
        required: false,
        description:
          "Array of {email, field} objects (field: EMAIL1, EMAIL2, EMAIL3)",
      },
      givenName: { type: "string", required: false },
      familyName: { type: "string", required: false },
      phoneNumbers: {
        type: "array",
        required: false,
        description: "Array of {number, field, type} objects",
      },
      addresses: {
        type: "array",
        required: false,
        description:
          "Array of address objects (line1, line2, locality, region, zip_code, country_code, field)",
      },
      faxNumbers: {
        type: "array",
        required: false,
        description: "Array of {number, type} objects",
      },
      socialAccounts: {
        type: "array",
        required: false,
        description: "Array of {name, type} objects",
      },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "Additional fields: contact_type, job_title, lead_source_id, middle_name, opt_in_reason, owner_id, preferred_locale, preferred_name, source_type, spouse_name, time_zone, website, anniversary, company (as {id: number}), origin (as {ip_address: string})",
      },
    },
    async execute(input, ctx) {
      const {
        duplicateOption,
        emailAddresses,
        givenName,
        familyName,
        phoneNumbers,
        addresses,
        faxNumbers,
        socialAccounts,
        additionalFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        duplicate_option: duplicateOption,
      };
      if (givenName) body.given_name = givenName;
      if (familyName) body.family_name = familyName;
      if (emailAddresses) body.email_addresses = emailAddresses;
      if (phoneNumbers) body.phone_numbers = phoneNumbers;
      if (addresses) body.addresses = addresses;
      if (faxNumbers) body.fax_numbers = faxNumbers;
      if (socialAccounts) body.social_accounts = socialAccounts;
      if (additionalFields) Object.assign(body, additionalFields);
      return apiRequest(ctx, "PUT", "contacts", body);
    },
  });

  rl.registerAction("contact.get", {
    access: "read",
    description: "Get a contact by ID",
    inputSchema: {
      contactId: { type: "number", required: true },
      optionalProperties: {
        type: "string",
        required: false,
        description: "Comma-separated optional fields",
      },
    },
    async execute(input, ctx) {
      const { contactId, optionalProperties } = input as Record<
        string,
        unknown
      >;
      const qs: Record<string, unknown> = {};
      if (optionalProperties) qs.optional_properties = optionalProperties;
      return apiRequest(
        ctx,
        "GET",
        `contacts/${pathSegment(contactId)}`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("contact.list", {
    access: "read",
    description: "List contacts",
    inputSchema: {
      limit: { type: "number", required: false },
      email: { type: "string", required: false },
      givenName: { type: "string", required: false },
      familyName: { type: "string", required: false },
      order: { type: "string", required: false },
      orderDirection: {
        type: "string",
        required: false,
        description: "ASCENDING or DESCENDING",
      },
      since: { type: "string", required: false, description: "ISO date" },
      until: { type: "string", required: false, description: "ISO date" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.email) qs.email = p.email;
      if (p.givenName) qs.given_name = p.givenName;
      if (p.familyName) qs.family_name = p.familyName;
      if (p.order) qs.order = p.order;
      if (p.orderDirection) qs.order_direction = p.orderDirection;
      if (p.since) qs.since = p.since;
      if (p.until) qs.until = p.until;
      const data = (await apiRequest(
        ctx,
        "GET",
        "contacts",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.contacts;
    },
  });

  rl.registerAction("contact.delete", {
    access: "write",
    description: "Delete a contact",
    inputSchema: { contactId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `contacts/${pathSegment((input as { contactId: number }).contactId)}`,
      );
      return { success: true };
    },
  });

  // ── Contact Note ────────────────────────────────────
  rl.registerAction("contactNote.create", {
    access: "write",
    description: "Create a note on a contact",
    inputSchema: {
      userId: {
        type: "number",
        required: true,
        description: "Keap user ID who is creating the note",
      },
      contactId: { type: "number", required: true },
      body: { type: "string", required: false, description: "Note body text" },
      title: { type: "string", required: false },
      type: {
        type: "string",
        required: false,
        description: "Appointment, Call, Email, Fax, Letter, Other",
      },
    },
    async execute(input, ctx) {
      const {
        userId,
        contactId,
        body: noteBody,
        title,
        type,
      } = input as Record<string, unknown>;
      const b: Record<string, unknown> = {
        user_id: userId,
        contact_id: contactId,
      };
      if (noteBody) b.body = noteBody;
      if (title) b.title = title;
      if (type) b.type = type;
      return apiRequest(ctx, "POST", "notes", b);
    },
  });

  rl.registerAction("contactNote.get", {
    access: "read",
    description: "Get a note",
    inputSchema: { noteId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `notes/${pathSegment((input as { noteId: number }).noteId)}`,
      );
    },
  });

  rl.registerAction("contactNote.list", {
    access: "read",
    description: "List notes (optionally filtered by contact_id, user_id)",
    inputSchema: {
      limit: { type: "number", required: false },
      contactId: {
        type: "number",
        required: false,
        description: "Filter by contact",
      },
      userId: {
        type: "number",
        required: false,
        description: "Filter by user",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.contactId) qs.contact_id = p.contactId;
      if (p.userId) qs.user_id = p.userId;
      const data = (await apiRequest(
        ctx,
        "GET",
        "notes",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.notes;
    },
  });

  rl.registerAction("contactNote.update", {
    access: "write",
    description: "Update a note",
    inputSchema: {
      noteId: { type: "number", required: true },
      body: { type: "string", required: false },
      title: { type: "string", required: false },
      type: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { noteId, body: b, title, type } = input as Record<string, unknown>;
      const bd: Record<string, unknown> = {};
      if (b) bd.body = b;
      if (title) bd.title = title;
      if (type) bd.type = type;
      return apiRequest(ctx, "PATCH", `notes/${pathSegment(noteId)}`, bd);
    },
  });

  rl.registerAction("contactNote.delete", {
    access: "write",
    description: "Delete a note",
    inputSchema: { noteId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `notes/${pathSegment((input as { noteId: number }).noteId)}`,
      );
      return { success: true };
    },
  });

  // ── Contact Tag ─────────────────────────────────────
  rl.registerAction("contactTag.add", {
    access: "write",
    description: "Apply tags to a contact",
    inputSchema: {
      contactId: { type: "number", required: true },
      tagIds: {
        type: "array",
        required: true,
        description: "Array of tag IDs to apply",
      },
    },
    async execute(input, ctx) {
      const { contactId, tagIds } = input as Record<string, unknown>;
      return apiRequest(
        ctx,
        "POST",
        `contacts/${pathSegment(contactId)}/tags`,
        {
          tagIds,
        },
      );
    },
  });

  rl.registerAction("contactTag.remove", {
    access: "write",
    description: "Remove tags from a contact",
    inputSchema: {
      contactId: { type: "number", required: true },
      tagIds: {
        type: "string",
        required: true,
        description: "Comma-separated tag IDs to remove",
      },
    },
    async execute(input, ctx) {
      const { contactId, tagIds } = input as Record<string, unknown>;
      await apiRequest(
        ctx,
        "DELETE",
        `contacts/${pathSegment(contactId)}/tags`,
        undefined,
        { ids: tagIds as string },
      );
      return { success: true };
    },
  });

  rl.registerAction("contactTag.list", {
    access: "read",
    description: "List tags on a contact",
    inputSchema: {
      contactId: { type: "number", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { contactId, limit } = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        `contacts/${pathSegment(contactId)}/tags`,
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.tags;
    },
  });

  // ── E-commerce Order ────────────────────────────────
  rl.registerAction("order.create", {
    access: "write",
    description: "Create an order",
    inputSchema: {
      contactId: { type: "number", required: true },
      orderDate: { type: "string", required: true, description: "ISO date" },
      orderTitle: { type: "string", required: true },
      orderType: {
        type: "string",
        required: true,
        description: "Online, Offline, etc.",
      },
      orderItems: {
        type: "array",
        required: true,
        description:
          "Array of order item objects (product_id, quantity, price, etc.)",
      },
      shippingAddress: { type: "object", required: false },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "promo_codes (array), lead_affiliate_id, sale_affiliate_id, etc.",
      },
    },
    async execute(input, ctx) {
      const {
        contactId,
        orderDate,
        orderTitle,
        orderType,
        orderItems,
        shippingAddress,
        additionalFields,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        contact_id: contactId,
        order_date: orderDate,
        order_title: orderTitle,
        order_type: orderType,
        order_items: orderItems,
      };
      if (shippingAddress) body.shipping_address = shippingAddress;
      if (additionalFields) Object.assign(body, additionalFields);
      return apiRequest(ctx, "POST", "orders", body);
    },
  });

  rl.registerAction("order.get", {
    access: "read",
    description: "Get an order",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `orders/${pathSegment((input as { orderId: number }).orderId)}`,
      );
    },
  });

  rl.registerAction("order.list", {
    access: "read",
    description: "List orders",
    inputSchema: {
      limit: { type: "number", required: false },
      contactId: { type: "number", required: false },
      since: { type: "string", required: false },
      until: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.contactId) qs.contact_id = p.contactId;
      if (p.since) qs.since = p.since;
      if (p.until) qs.until = p.until;
      const data = (await apiRequest(
        ctx,
        "GET",
        "orders",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.orders;
    },
  });

  rl.registerAction("order.delete", {
    access: "write",
    description: "Delete an order",
    inputSchema: { orderId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `orders/${pathSegment((input as { orderId: number }).orderId)}`,
      );
      return { success: true };
    },
  });

  // ── E-commerce Product ──────────────────────────────
  rl.registerAction("product.create", {
    access: "write",
    description: "Create a product",
    inputSchema: {
      productName: { type: "string", required: true },
      additionalFields: {
        type: "object",
        required: false,
        description: "product_price, product_desc, sku, etc.",
      },
    },
    async execute(input, ctx) {
      const { productName, additionalFields } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { product_name: productName };
      if (additionalFields) Object.assign(body, additionalFields);
      return apiRequest(ctx, "POST", "products", body);
    },
  });

  rl.registerAction("product.get", {
    access: "read",
    description: "Get a product",
    inputSchema: { productId: { type: "number", required: true } },
    async execute(input, ctx) {
      return apiRequest(
        ctx,
        "GET",
        `products/${pathSegment((input as { productId: number }).productId)}`,
      );
    },
  });

  rl.registerAction("product.list", {
    access: "read",
    description: "List products",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit)
        qs.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(
        ctx,
        "GET",
        "products",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.products;
    },
  });

  rl.registerAction("product.delete", {
    access: "write",
    description: "Delete a product",
    inputSchema: { productId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `products/${pathSegment((input as { productId: number }).productId)}`,
      );
      return { success: true };
    },
  });

  // ── Email ───────────────────────────────────────────
  rl.registerAction("email.createRecord", {
    access: "write",
    description: "Create an email record (log a sent email)",
    inputSchema: {
      sentFromAddress: { type: "string", required: true },
      sentToAddress: { type: "string", required: true },
      additionalFields: {
        type: "object",
        required: false,
        description:
          "subject, sent_date, received_date, headers, html_content, plain_content, etc.",
      },
    },
    async execute(input, ctx) {
      const { sentFromAddress, sentToAddress, additionalFields } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        sent_to_address: sentToAddress,
        sent_from_address: sentFromAddress,
      };
      if (additionalFields) Object.assign(body, additionalFields);
      return apiRequest(ctx, "POST", "emails", body);
    },
  });

  rl.registerAction("email.delete", {
    access: "write",
    description: "Delete an email record",
    inputSchema: { emailRecordId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `emails/${pathSegment((input as { emailRecordId: number }).emailRecordId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("email.list", {
    access: "read",
    description: "List email records",
    inputSchema: {
      limit: { type: "number", required: false },
      contactId: { type: "number", required: false },
      email: { type: "string", required: false },
      sinceDate: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.contactId) qs.contact_id = p.contactId;
      if (p.email) qs.email = p.email;
      if (p.sinceDate) qs.since_sent_date = p.sinceDate;
      const data = (await apiRequest(
        ctx,
        "GET",
        "emails",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.emails;
    },
  });

  rl.registerAction("email.send", {
    access: "write",
    description: "Queue an email to be sent",
    inputSchema: {
      userId: {
        type: "number",
        required: true,
        description: "Keap user ID sending the email",
      },
      contactIds: {
        type: "array",
        required: true,
        description: "Array of contact IDs to send to",
      },
      subject: { type: "string", required: true },
      htmlContent: { type: "string", required: false },
      plainContent: { type: "string", required: false },
      attachments: {
        type: "array",
        required: false,
        description: "Array of {file_data, file_name} objects",
      },
    },
    async execute(input, ctx) {
      const {
        userId,
        contactIds,
        subject,
        htmlContent,
        plainContent,
        attachments,
      } = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        user_id: userId,
        contacts: contactIds,
        subject,
      };
      if (htmlContent) body.html_content = htmlContent;
      if (plainContent) body.plain_content = plainContent;
      if (attachments) body.attachments = attachments;
      await apiRequest(ctx, "POST", "emails/queue", body);
      return { success: true };
    },
  });

  // ── File ────────────────────────────────────────────
  rl.registerAction("file.delete", {
    access: "write",
    description: "Delete a file",
    inputSchema: { fileId: { type: "number", required: true } },
    async execute(input, ctx) {
      await apiRequest(
        ctx,
        "DELETE",
        `files/${pathSegment((input as { fileId: number }).fileId)}`,
      );
      return { success: true };
    },
  });

  rl.registerAction("file.list", {
    access: "read",
    description: "List files",
    inputSchema: {
      limit: { type: "number", required: false },
      permission: {
        type: "string",
        required: false,
        description: "USER, COMPANY",
      },
      type: {
        type: "string",
        required: false,
        description:
          "Application, Image, Fax, Attachment, Ticket, Contact, Digital Product, Import, Hidden, Webform, Styled Cart, Logo, Resampled, Template Thumbnail, Funnel",
      },
      viewable: {
        type: "string",
        required: false,
        description: "PUBLIC, PRIVATE, BOTH",
      },
      contactId: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.limit = p.limit;
      if (p.permission) qs.permission = (p.permission as string).toUpperCase();
      if (p.type) qs.type = p.type;
      if (p.viewable) qs.viewable = (p.viewable as string).toUpperCase();
      if (p.contactId) qs.contact_id = p.contactId;
      const data = (await apiRequest(
        ctx,
        "GET",
        "files",
        undefined,
        qs,
      )) as Record<string, unknown>;
      return data.files;
    },
  });
}
