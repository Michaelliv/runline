import type { RunlinePluginAPI } from "runline";

const GQL_URL = "https://graphql.emelia.io/graphql";

async function gql(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query };
  if (variables) body.variables = variables;
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Emelia API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.errors)
    throw new Error(`Emelia GraphQL error: ${JSON.stringify(data.errors)}`);
  return data.data as Record<string, unknown>;
}

export default function emelia(rl: RunlinePluginAPI) {
  rl.setName("emelia");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Emelia API key",
      env: "EMELIA_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  // ── Campaign ────────────────────────────────────────

  rl.registerAction("campaign.create", {
    access: "write",
    description: "Create a new campaign",
    inputSchema: {
      name: { type: "string", required: true, description: "Campaign name" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `
        mutation createCampaign($name: String!) {
          createCampaign(name: $name) { _id name status createdAt provider startAt estimatedEnd }
        }`,
        { name: (input as { name: string }).name },
      );
      return data.createCampaign;
    },
  });

  rl.registerAction("campaign.get", {
    access: "read",
    description: "Get a campaign by ID",
    inputSchema: {
      campaignId: {
        type: "string",
        required: true,
        description: "Campaign ID",
      },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `
        query campaign($id: ID!) {
          campaign(id: $id) {
            _id name status createdAt provider startAt estimatedEnd
            schedule { dailyContact dailyLimit minInterval maxInterval trackLinks trackOpens timeZone days start end }
            recipients { total_count }
          }
        }`,
        { id: (input as { campaignId: string }).campaignId },
      );
      return data.campaign;
    },
  });

  rl.registerAction("campaign.list", {
    access: "read",
    description: "List all campaigns",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = await gql(
        key(ctx),
        `
        query all_campaigns {
          all_campaigns {
            _id name status createdAt
            stats { mailsSent uniqueOpensPercent opens linkClickedPercent repliedPercent bouncedPercent unsubscribePercent progressPercent }
          }
        }`,
      );
      const campaigns = data.all_campaigns as unknown[];
      if (limit) return campaigns.slice(0, limit);
      return campaigns;
    },
  });

  rl.registerAction("campaign.addContact", {
    access: "write",
    description: "Add a contact to a campaign",
    inputSchema: {
      campaignId: {
        type: "string",
        required: true,
        description: "Campaign ID",
      },
      email: { type: "string", required: true, description: "Contact email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { campaignId, email, firstName, lastName, customFields } =
        input as Record<string, unknown>;
      const contact: Record<string, unknown> = { email };
      if (firstName) contact.firstName = firstName;
      if (lastName) contact.lastName = lastName;
      if (customFields) Object.assign(contact, customFields);
      const data = await gql(
        key(ctx),
        `
        mutation AddContactToCampaignHook($id: ID!, $contact: JSON!) {
          addContactToCampaignHook(id: $id, contact: $contact)
        }`,
        { id: campaignId, contact },
      );
      return { contactId: data.addContactToCampaignHook };
    },
  });

  rl.registerAction("campaign.start", {
    access: "write",
    description: "Start a campaign",
    inputSchema: {
      campaignId: {
        type: "string",
        required: true,
        description: "Campaign ID",
      },
    },
    async execute(input, ctx) {
      await gql(
        key(ctx),
        `mutation startCampaign($id: ID!) { startCampaign(id: $id) }`,
        { id: (input as { campaignId: string }).campaignId },
      );
      return { success: true };
    },
  });

  rl.registerAction("campaign.pause", {
    access: "write",
    description: "Pause a campaign",
    inputSchema: {
      campaignId: {
        type: "string",
        required: true,
        description: "Campaign ID",
      },
    },
    async execute(input, ctx) {
      await gql(
        key(ctx),
        `mutation pauseCampaign($id: ID!) { pauseCampaign(id: $id) }`,
        { id: (input as { campaignId: string }).campaignId },
      );
      return { success: true };
    },
  });

  rl.registerAction("campaign.duplicate", {
    access: "write",
    description: "Duplicate a campaign",
    inputSchema: {
      campaignId: {
        type: "string",
        required: true,
        description: "Source campaign ID",
      },
      name: {
        type: "string",
        required: true,
        description: "New campaign name",
      },
      copySettings: {
        type: "boolean",
        required: false,
        description: "Copy settings (default: true)",
      },
      copyMails: {
        type: "boolean",
        required: false,
        description: "Copy mail templates (default: true)",
      },
      copyContacts: {
        type: "boolean",
        required: false,
        description: "Copy contacts (default: false)",
      },
      copyProvider: {
        type: "boolean",
        required: false,
        description: "Copy provider (default: true)",
      },
    },
    async execute(input, ctx) {
      const {
        campaignId,
        name,
        copySettings = true,
        copyMails = true,
        copyContacts = false,
        copyProvider = true,
      } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `
        mutation duplicateCampaign($fromId: ID!, $name: String!, $copySettings: Boolean!, $copyMails: Boolean!, $copyContacts: Boolean!, $copyProvider: Boolean!) {
          duplicateCampaign(fromId: $fromId, name: $name, copySettings: $copySettings, copyMails: $copyMails, copyContacts: $copyContacts, copyProvider: $copyProvider)
        }`,
        {
          fromId: campaignId,
          name,
          copySettings,
          copyMails,
          copyContacts,
          copyProvider,
        },
      );
      return { _id: data.duplicateCampaign };
    },
  });

  // ── Contact List ────────────────────────────────────

  rl.registerAction("contactList.list", {
    access: "read",
    description: "List all contact lists",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = await gql(
        key(ctx),
        `
        query contact_lists {
          contact_lists { _id name contactCount fields usedInCampaign }
        }`,
      );
      const lists = data.contact_lists as unknown[];
      if (limit) return lists.slice(0, limit);
      return lists;
    },
  });

  rl.registerAction("contactList.addContact", {
    access: "write",
    description: "Add a contact to a contact list",
    inputSchema: {
      contactListId: {
        type: "string",
        required: true,
        description: "Contact list ID",
      },
      email: { type: "string", required: true, description: "Contact email" },
      firstName: { type: "string", required: false, description: "First name" },
      lastName: { type: "string", required: false, description: "Last name" },
      customFields: {
        type: "object",
        required: false,
        description: "Custom fields as key-value pairs",
      },
    },
    async execute(input, ctx) {
      const { contactListId, email, firstName, lastName, customFields } =
        input as Record<string, unknown>;
      const contact: Record<string, unknown> = { email };
      if (firstName) contact.firstName = firstName;
      if (lastName) contact.lastName = lastName;
      if (customFields) Object.assign(contact, customFields);
      const data = await gql(
        key(ctx),
        `
        mutation AddContactsToListHook($id: ID!, $contact: JSON!) {
          addContactsToListHook(id: $id, contact: $contact)
        }`,
        { id: contactListId, contact },
      );
      return { contactId: data.addContactsToListHook };
    },
  });
}
