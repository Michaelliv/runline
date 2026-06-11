import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { COMMENT_FIELDS, assertCommentInScope, assertIssueInScope, gql, key, requireUnscoped } from "./shared.js";

export function registerCommentActions(rl: RunlinePluginAPI) {
  rl.registerAction("issue.addComment", {
    description: "Add a comment to an issue. Pass parentId to nest as a reply.",
    inputSchema: t.Object({
      issueId: t.String({ description: "The issue to associate the comment with. UUID or issue identifier (e.g., 'LIN-123')" }),
      body: t.String({ description: "The comment content in markdown format" }),
      parentId: t.Optional(t.String({ description: "The parent comment under which to nest as a reply" })),
      doNotSubscribeToIssue: t.Optional(t.Boolean({ description: "Prevent auto-subscription to the issue the comment is created on" })),
      quotedText: t.Optional(t.String({ description: "The text that this comment references (inline comments)" })),
    }),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      await assertIssueInScope(ctx, String(fields.issueId));
      const data = await gql(
        key(ctx),
        `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
        { input: fields },
      );
      return (data.commentCreate as Record<string, unknown>)?.comment;
    },
  });

  rl.registerAction("comment.list", {
    description: "List comments. Pass issueId (UUID or identifier like 'LIN-123') to list one issue's comments; without it, lists workspace-wide (unscoped connections only).",
    inputSchema: t.Object(
      {
        issueId: t.Optional(t.String({ description: "Only list comments on this issue. UUID or issue identifier (e.g., 'LIN-123')" })),
        limit: t.Optional(t.Number({ description: "Max results (default 50)" })),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const { issueId, limit = 50 } = (input ?? {}) as { issueId?: string; limit?: number };
      if (issueId) {
        await assertIssueInScope(ctx, issueId);
        const data = await gql(
          key(ctx),
          `query($id: String!, $first: Int) { issue(id: $id) { comments(first: $first) { nodes { ${COMMENT_FIELDS} } pageInfo { hasNextPage endCursor } } } }`,
          { id: issueId, first: limit },
        );
        return ((data.issue as Record<string, unknown> | null)?.comments as Record<string, unknown>) ?? null;
      }
      requireUnscoped(ctx, "comment.list");
      const data = await gql(
        key(ctx),
        `query($first: Int) { comments(first: $first) { nodes { ${COMMENT_FIELDS} } pageInfo { hasNextPage endCursor } } }`,
        { first: limit },
      );
      return data.comments;
    },
  });
  rl.registerAction("comment.get", {
    description: "Get a comment by ID.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      const id = (input as { id: string }).id;
      await assertCommentInScope(ctx, id);
      const data = await gql(
        key(ctx),
        `query($id: String!) { comment(id: $id) { ${COMMENT_FIELDS} } }`,
        { id },
      );
      return data.comment;
    },
  });
  rl.registerAction("comment.update", {
    description: "Update a comment.",
    inputSchema: t.Object({
      id: t.String({ description: "The identifier of the comment to update" }),
      body: t.Optional(t.String({ description: "The comment content in markdown format" })),
      quotedText: t.Optional(t.String({ description: "The text that this comment references (inline comments)" })),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      await assertCommentInScope(ctx, String(id));
      const data = await gql(
        key(ctx),
        `mutation($id: String!, $input: CommentUpdateInput!) { commentUpdate(id: $id, input: $input) { success comment { ${COMMENT_FIELDS} } } }`,
        { id, input: fields },
      );
      return (data.commentUpdate as Record<string, unknown>)?.comment;
    },
  });
  rl.registerAction("comment.delete", {
    description: "Delete a comment.",
    inputSchema: t.Object({ id: t.String() }),
    async execute(input, ctx) {
      const id = (input as { id: string }).id;
      await assertCommentInScope(ctx, id);
      const data = await gql(
        key(ctx),
        `mutation($id: String!) { commentDelete(id: $id) { success } }`,
        { id },
      );
      return data.commentDelete;
    },
  });
}
