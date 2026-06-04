import type { RunlinePluginAPI } from "runline";
import { WEBHOOK_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerWebhookActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("webhook.list", "List webhooks for the current workspace.", "webhooks", null, WEBHOOK_FIELDS);
  getAction("webhook.get", "Get a webhook by ID.", "webhook", WEBHOOK_FIELDS);
  rl.registerAction("webhook.create", {
    description: "Create a webhook. resourceTypes example: ['Issue','Comment','Project'].",
    inputSchema: {
      url: { type: "string", required: true, description: "The URL that will be called on data changes" },
      resourceTypes: { type: "array", required: true, description: "List of resources the webhook should subscribe to (e.g. ['Issue','Comment'])" },
      label: { type: "string", required: false, description: "Label for the webhook" },
      teamId: { type: "string", required: false, description: "The identifier or key of the team associated with the webhook. Omit and set allPublicTeams=true for workspace-wide" },
      allPublicTeams: { type: "boolean", required: false, description: "Whether this webhook is enabled for all public teams" },
      enabled: { type: "boolean", required: false, description: "Whether this webhook is enabled (default true)" },
      secret: { type: "string", required: false, description: "A secret token used to sign the webhook payload" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { ${WEBHOOK_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.webhookCreate as Record<string, unknown>)?.webhook;
    },
  });
  rl.registerAction("webhook.update", {
    description: "Update a webhook. teamId and allPublicTeams cannot be changed after creation.",
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the webhook to update" },
      url: { type: "string", required: false, description: "The URL that will be called on data changes" },
      resourceTypes: { type: "array", required: false, description: "List of resources the webhook should subscribe to" },
      label: { type: "string", required: false, description: "Label for the webhook" },
      enabled: { type: "boolean", required: false, description: "Whether this webhook is enabled" },
      secret: { type: "string", required: false, description: "A secret token used to sign the webhook payload" },
    },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: WebhookUpdateInput!) { webhookUpdate(id: $id, input: $input) { success webhook { ${WEBHOOK_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.webhookUpdate as Record<string, unknown>)?.webhook;
    },
  });
  rl.registerAction("webhook.delete", {
    description: "Delete a webhook.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the webhook to delete" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { webhookDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.webhookDelete;
    },
  });
  rl.registerAction("webhook.rotateSecret", {
    description: "Rotate a webhook's signing secret. Returns the new secret.",
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the webhook to rotate the secret for" } },
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { webhookRotateSecret(id: $id) { success secret } }`,
        { id: (input as { id: string }).id },
      );
      return data.webhookRotateSecret;
    },
  });
}
