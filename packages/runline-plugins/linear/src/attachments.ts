import type { RunlinePluginAPI } from "runline";
import { ATTACHMENT_FIELDS, bindGetAction, bindListAction, gql, key } from "./shared.js";

export function registerAttachmentActions(rl: RunlinePluginAPI) {
  const listAction = bindListAction(rl);
  const getAction = bindGetAction(rl);

  listAction("attachment.list", "List issue attachments.", "attachments", "AttachmentFilter", ATTACHMENT_FIELDS);
  getAction("attachment.get", "Get an attachment by ID.", "attachment", ATTACHMENT_FIELDS);
  rl.registerAction("attachment.create", {
    description: "Create an attachment on an issue.",
    inputSchema: {
      issueId: { type: "string", required: true, description: "The issue to associate the attachment with. UUID or issue identifier (e.g., 'LIN-123')" },
      title: { type: "string", required: true, description: "The attachment title" },
      url: { type: "string", required: true, description: "Attachment location, also used as a unique identifier. Re-creating with the same url updates the existing record" },
      subtitle: { type: "string", required: false, description: "The attachment subtitle" },
      iconUrl: { type: "string", required: false, description: "An icon url to display with the attachment (jpg or png, max 1MB, ideally 20x20px)" },
      commentBody: { type: "string", required: false, description: "Create a linked comment with markdown body" },
      groupBySource: { type: "boolean", required: false, description: "Whether attachments for the same source application should be grouped in the Linear UI" },
      metadata: { type: "object", required: false, description: "Attachment metadata object with string and number values (JSONObject)" },
      id: { type: "string", required: false, description: "The identifier in UUID v4 format. If none is provided, the backend will generate one" },
    },
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
    inputSchema: {
      id: { type: "string", required: true, description: "The identifier of the attachment to update" },
      title: { type: "string", required: true, description: "The attachment title" },
      subtitle: { type: "string", required: false, description: "The attachment subtitle" },
      iconUrl: { type: "string", required: false, description: "An icon url to display with the attachment" },
      metadata: { type: "object", required: false, description: "Attachment metadata object with string and number values (JSONObject)" },
    },
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
    inputSchema: {
      issueId: { type: "string", required: true, description: "The issue for which to link the url. UUID or issue identifier (e.g., 'LIN-123')" },
      url: { type: "string", required: true, description: "The url to link" },
      title: { type: "string", required: false, description: "The title to use for the attachment" },
      id: { type: "string", required: false, description: "The id for the attachment (optional UUID override)" },
    },
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
    inputSchema: { id: { type: "string", required: true, description: "The identifier of the attachment to delete" } },
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
