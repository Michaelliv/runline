import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { ATTACHMENT_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerAttachmentActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("attachment.list", "List issue attachments.", "attachments", "AttachmentFilter", ATTACHMENT_FIELDS);
  getAction("attachment.get", "Get an attachment by ID.", "attachment", ATTACHMENT_FIELDS);
  rl.registerAction("attachment.create", {
    description: "Create an attachment on an issue.",
    inputSchema: t.Object({
      issueId: t.String({ description: "The issue to associate the attachment with. UUID or issue identifier (e.g., 'LIN-123')" }),
      title: t.String({ description: "The attachment title" }),
      url: t.String({ description: "Attachment location, also used as a unique identifier. Re-creating with the same url updates the existing record" }),
      subtitle: t.Optional(t.String({ description: "The attachment subtitle" })),
      iconUrl: t.Optional(t.String({ description: "An icon url to display with the attachment (jpg or png, max 1MB, ideally 20x20px)" })),
      commentBody: t.Optional(t.String({ description: "Create a linked comment with markdown body" })),
      groupBySource: t.Optional(t.Boolean({ description: "Whether attachments for the same source application should be grouped in the Linear UI" })),
      metadata: t.Optional(t.Object({}, { description: "Attachment metadata object with string and number values (JSONObject)" })),
      id: t.Optional(t.String({ description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" })),
    }),
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
        { input: input as Record<string, unknown> },
      );
      return (data.attachmentCreate as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.update", {
    description: "Update an attachment. title is required.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the attachment to update" }),
      title: t.String({ description: "The attachment title" }),
      subtitle: t.Optional(t.String({ description: "The attachment subtitle" })),
      iconUrl: t.Optional(t.String({ description: "An icon url to display with the attachment" })),
      metadata: t.Optional(t.Object({}, { description: "Attachment metadata object with string and number values (JSONObject)" })),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: AttachmentUpdateInput!) { attachmentUpdate(id: $id, input: $input) { success attachment { ${ATTACHMENT_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.attachmentUpdate as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.linkURL", {
    description: "Link any URL to an issue. If a workspace integration matches the URL (Zendesk, GitHub, Slack, etc.) a rich attachment is created; otherwise a basic one.",
    inputSchema: t.Object({
      issueId: t.String({ description: "The issue for which to link the url. UUID or issue identifier (e.g., 'LIN-123')" }),
      url: t.String({ description: "The url to link" }),
      title: t.Optional(t.String({ description: "The title to use for the attachment" })),
      id: t.Optional(t.String({ description: "The id for the attachment (optional UUID override)" })),
    }),
    async execute(input, ctx) {
      const { issueId, url, title, id } = input as Record<string, unknown>;
      const data = await gql(
        key(ctx),
        `mutation($issueId: String!, $url: String!, $title: String, $id: String) {
          attachmentLinkURL(issueId: $issueId, url: $url, title: $title, id: $id) { success attachment { ${ATTACHMENT_FIELDS} } }
        }`,
        { issueId, url, title: title ?? null, id: id ?? null },
      );
      return (data.attachmentLinkURL as Record<string, unknown>)?.attachment;
    },
  });
  rl.registerAction("attachment.delete", {
    description: "Delete an attachment.",
    inputSchema: t.Object({ id: t.String({ description: "The identifier of the attachment to delete" }) }),
    async execute(input, ctx) {
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { attachmentDelete(id: $id) { success } }`,
        { id: (input as { id: string }).id },
      );
      return data.attachmentDelete;
    },
  });
}
