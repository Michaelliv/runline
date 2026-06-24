import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  bindGetAction,
  bindListAction,
  gql,
  key,
  requireUnscoped,
  WEBHOOK_FIELDS,
} from "./shared.js";

export function registerWebhookActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction(
    "webhook.list",
    "List webhooks for the current workspace.",
    "webhooks",
    null,
    WEBHOOK_FIELDS,
  );
  getAction("webhook.get", "Get a webhook by ID.", "webhook", WEBHOOK_FIELDS);
  rl.registerAction("webhook.create", {
    description:
      "Create a webhook. resourceTypes example: ['Issue','Comment','Project'].",
    inputSchema: t.Object({
      url: t.String({
        description: "The URL that will be called on data changes",
      }),
      resourceTypes: t.Array(t.String(), {
        description:
          "List of resources the webhook should subscribe to (e.g. ['Issue','Comment'])",
      }),
      label: t.Optional(t.String({ description: "Label for the webhook" })),
      teamId: t.Optional(
        t.String({
          description:
            "The identifier or key of the team associated with the webhook. Omit and set allPublicTeams=true for workspace-wide",
        }),
      ),
      allPublicTeams: t.Optional(
        t.Boolean({
          description: "Whether this webhook is enabled for all public teams",
        }),
      ),
      enabled: t.Optional(
        t.Boolean({
          description: "Whether this webhook is enabled (default true)",
        }),
      ),
      secret: t.Optional(
        t.String({
          description: "A secret token used to sign the webhook payload",
        }),
      ),
      id: t.Optional(
        t.String({
          description:
            "The identifier in UUID v4 format. If none is provided, the backend will generate one",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "webhooks.*");
      const data = await gql(
        key(ctx),
        `mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { success webhook { ${WEBHOOK_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.webhookCreate as Record<string, unknown>)?.webhook;
    },
  });
  rl.registerAction("webhook.update", {
    description:
      "Update a webhook. teamId and allPublicTeams cannot be changed after creation.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the webhook to update" }),
      url: t.Optional(
        t.String({
          description: "The URL that will be called on data changes",
        }),
      ),
      resourceTypes: t.Optional(
        t.Array(t.String(), {
          description: "List of resources the webhook should subscribe to",
        }),
      ),
      label: t.Optional(t.String({ description: "Label for the webhook" })),
      enabled: t.Optional(
        t.Boolean({ description: "Whether this webhook is enabled" }),
      ),
      secret: t.Optional(
        t.String({
          description: "A secret token used to sign the webhook payload",
        }),
      ),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "webhooks.*");
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
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the webhook to delete" }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "webhooks.*");
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
    inputSchema: t.Object({
      id: t.String({
        description: "The identifier of the webhook to rotate the secret for",
      }),
    }),
    async execute(input, ctx) {
      requireUnscoped(ctx, "webhooks.*");
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { webhookRotateSecret(id: $id) { success secret } }`,
        { id: (input as { id: string }).id },
      );
      return data.webhookRotateSecret;
    },
  });
}
