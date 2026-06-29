import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  PAGE_STATUS,
  PAGE_VISIBILITY,
  pageRenderUrl,
  request,
} from "./shared.js";

export function registerPageActions(rl: RunlinePluginAPI) {
  rl.registerAction("page.list", {
    description: "List Shift Labs pages for the API key's organization.",
    inputSchema: t.Object({
      status: t.Optional(enumSchema("Page status", PAGE_STATUS)),
      limit: t.Optional(t.Number({ description: "Max results, default 50" })),
    }),
    async execute(input, ctx) {
      const fields = (input ?? {}) as Record<string, unknown>;
      const params = new URLSearchParams();
      if (fields.status) params.set("status", String(fields.status));
      if (fields.limit) params.set("limit", String(fields.limit));
      const body = await request<{ pages: unknown[] }>(
        ctx,
        `/v1/pages?${params}`,
      );
      return body.pages;
    },
  });

  rl.registerAction("page.get", {
    description: "Get a Shift Labs page by ID.",
    inputSchema: t.Object({ id: t.String({ description: "Page ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: unknown }>(
        ctx,
        `/v1/pages/${encodeURIComponent(id)}`,
      );
      return body.page;
    },
  });

  rl.registerAction("page.create", {
    description:
      "Create a draft hosted HTML page. Agents can publish it with page.publish.",
    inputSchema: t.Object({
      slug: t.String({ description: "Lowercase kebab-case page slug" }),
      title: t.String({ description: "Page title" }),
      html: t.Optional(t.String({ description: "Hosted HTML content" })),
      visibility: t.Optional(enumSchema("Page visibility", PAGE_VISIBILITY)),
    }),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      const body = await request<{ page: unknown }>(ctx, "/v1/pages", {
        method: "POST",
        body: JSON.stringify({
          type: "hosted_html",
          visibility: "org",
          ...fields,
        }),
      });
      return body.page;
    },
  });

  rl.registerAction("page.update", {
    description:
      "Update a hosted HTML page's slug, title, visibility, or HTML.",
    inputSchema: t.Object({
      id: t.String({ description: "Page ID" }),
      slug: t.Optional(
        t.String({ description: "Lowercase kebab-case page slug" }),
      ),
      title: t.Optional(t.String({ description: "Page title" })),
      visibility: t.Optional(enumSchema("Page visibility", PAGE_VISIBILITY)),
      html: t.Optional(t.String({ description: "Hosted HTML content" })),
    }),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body = await request<{ page: unknown }>(
        ctx,
        `/v1/pages/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          body: JSON.stringify(fields),
        },
      );
      return body.page;
    },
  });

  rl.registerAction("page.publish", {
    description: "Publish a Shift Labs hosted HTML page.",
    inputSchema: t.Object({ id: t.String({ description: "Page ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: unknown }>(
        ctx,
        `/v1/pages/${encodeURIComponent(id)}/publish`,
        { method: "POST" },
      );
      return body.page;
    },
  });

  rl.registerAction("page.archive", {
    description: "Archive a Shift Labs page.",
    inputSchema: t.Object({ id: t.String({ description: "Page ID" }) }),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: unknown }>(
        ctx,
        `/v1/pages/${encodeURIComponent(id)}/archive`,
        { method: "POST" },
      );
      return body.page;
    },
  });

  rl.registerAction("page.shares", {
    description: "List shares for a Shift Labs page.",
    inputSchema: t.Object({ pageId: t.String({ description: "Page ID" }) }),
    async execute(input, ctx) {
      const { pageId } = input as { pageId: string };
      const body = await request<{ shares: unknown[] }>(
        ctx,
        `/v1/pages/${encodeURIComponent(pageId)}/shares`,
      );
      return body.shares;
    },
  });

  rl.registerAction("page.share", {
    description: "Create a viewer share for a Shift Labs page.",
    inputSchema: t.Object({
      pageId: t.String({ description: "Page ID" }),
      email: t.String({ description: "Viewer email address" }),
      expiresAt: t.Optional(
        t.String({ description: "Optional ISO expiration" }),
      ),
    }),
    async execute(input, ctx) {
      const { pageId, ...fields } = input as Record<string, unknown>;
      const body = await request<{ share: unknown }>(
        ctx,
        `/v1/pages/${encodeURIComponent(pageId)}/shares`,
        {
          method: "POST",
          body: JSON.stringify(fields),
        },
      );
      return body.share;
    },
  });

  rl.registerAction("page.revokeShare", {
    description: "Revoke a Shift Labs page share.",
    inputSchema: t.Object({
      shareId: t.String({ description: "Page share ID" }),
    }),
    async execute(input, ctx) {
      const { shareId } = input as { shareId: string };
      await request<void>(
        ctx,
        `/v1/pages/shares/${encodeURIComponent(shareId)}`,
        {
          method: "DELETE",
        },
      );
      return { success: true };
    },
  });

  rl.registerAction("page.renderUrl", {
    description: "Return the authenticated render URL for a page.",
    inputSchema: t.Object({
      pageId: t.String({ description: "Page ID" }),
    }),
    async execute(input, ctx) {
      const { pageId } = input as { pageId: string };
      const body = await request<{
        page: { organizationId: string; slug: string };
      }>(ctx, `/v1/pages/${encodeURIComponent(pageId)}`);
      return {
        url: pageRenderUrl(body.page.organizationId, body.page.slug),
      };
    },
  });
}
