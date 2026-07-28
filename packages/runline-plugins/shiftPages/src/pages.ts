import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  idSchema,
  listParams,
  PAGE_STATUS,
  PAGE_VISIBILITY,
  pageRenderUrl,
  pathSegment,
  request,
  STRICT_OBJECT,
  timestampSchema,
  withQuery,
} from "./shared.js";

export interface ShiftPage {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  type: "hosted_html" | "protected_origin";
  status: (typeof PAGE_STATUS)[number];
  visibility: (typeof PAGE_VISIBILITY)[number];
  html?: string;
  originUrl?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  publishedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftPageShare {
  id: string;
  pageId: string;
  organizationId: string;
  email: string;
  role: "viewer";
  status: "pending" | "accepted" | "revoked";
  invitedByUserId?: string;
  acceptedUserId?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

const PageSlug = t.String({
  minLength: 1,
  maxLength: 120,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  description: "Lowercase kebab-case page slug",
});

export function registerPageActions(rl: RunlinePluginAPI) {
  rl.registerAction("page.list", {
    access: "read",
    description: "List Shift Labs pages for the API key's organization.",
    inputSchema: t.Object(
      {
        status: t.Optional(enumSchema("Page status", PAGE_STATUS)),
        limit: t.Optional(
          t.Integer({
            minimum: 1,
            maximum: 100,
            description: "Max results, default 50",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ pages: ShiftPage[] }>(
        ctx,
        withQuery("/v1/pages", listParams(input)),
      );
      return body.pages;
    },
  });

  rl.registerAction("page.get", {
    access: "read",
    description: "Get a Shift Labs page by ID.",
    inputSchema: t.Object({ id: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: ShiftPage }>(
        ctx,
        `/v1/pages/${pathSegment(id)}`,
      );
      return body.page;
    },
  });

  rl.registerAction("page.create", {
    access: "write",
    description:
      "Create a draft hosted HTML page. Agents can publish it with page.publish.",
    inputSchema: t.Object(
      {
        slug: PageSlug,
        title: t.String({
          minLength: 1,
          maxLength: 160,
          pattern: "\\S",
          description: "Page title",
        }),
        html: t.Optional(
          t.String({
            maxLength: 1_000_000,
            description: "Hosted HTML content",
          }),
        ),
        visibility: t.Optional(enumSchema("Page visibility", PAGE_VISIBILITY)),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      const body = await request<{ page: ShiftPage }>(ctx, "/v1/pages", {
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
    access: "write",
    description:
      "Update a hosted HTML page's slug, title, visibility, or HTML.",
    inputSchema: t.Object(
      {
        id: idSchema("Page ID"),
        slug: t.Optional(PageSlug),
        title: t.Optional(
          t.String({
            minLength: 1,
            maxLength: 160,
            pattern: "\\S",
            description: "Page title",
          }),
        ),
        visibility: t.Optional(enumSchema("Page visibility", PAGE_VISIBILITY)),
        html: t.Optional(
          t.String({
            maxLength: 1_000_000,
            description: "Hosted HTML content",
          }),
        ),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body = await request<{ page: ShiftPage }>(
        ctx,
        `/v1/pages/${pathSegment(String(id))}`,
        {
          method: "PATCH",
          body: JSON.stringify(fields),
        },
      );
      return body.page;
    },
  });

  rl.registerAction("page.publish", {
    access: "write",
    description: "Publish a Shift Labs hosted HTML page.",
    inputSchema: t.Object({ id: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: ShiftPage }>(
        ctx,
        `/v1/pages/${pathSegment(id)}/publish`,
        { method: "POST" },
      );
      return body.page;
    },
  });

  rl.registerAction("page.archive", {
    access: "write",
    description: "Archive a Shift Labs page.",
    inputSchema: t.Object({ id: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ page: ShiftPage }>(
        ctx,
        `/v1/pages/${pathSegment(id)}/archive`,
        { method: "POST" },
      );
      return body.page;
    },
  });

  rl.registerAction("page.shares", {
    access: "read",
    description: "List shares for a Shift Labs page.",
    inputSchema: t.Object({ pageId: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { pageId } = input as { pageId: string };
      const body = await request<{ shares: ShiftPageShare[] }>(
        ctx,
        `/v1/pages/${pathSegment(pageId)}/shares`,
      );
      return body.shares;
    },
  });

  rl.registerAction("page.share", {
    access: "write",
    description: "Create a viewer share for a Shift Labs page.",
    inputSchema: t.Object(
      {
        pageId: idSchema("Page ID"),
        email: t.String({
          minLength: 1,
          format: "email",
          description: "Viewer email address",
        }),
        expiresAt: t.Optional(timestampSchema("Optional ISO-8601 expiration")),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { pageId, ...fields } = input as Record<string, unknown>;
      const body = await request<{ share: ShiftPageShare }>(
        ctx,
        `/v1/pages/${pathSegment(String(pageId))}/shares`,
        {
          method: "POST",
          body: JSON.stringify(fields),
        },
      );
      return body.share;
    },
  });

  rl.registerAction("page.revokeShare", {
    access: "write",
    description: "Revoke a Shift Labs page share.",
    inputSchema: t.Object(
      { shareId: idSchema("Page share ID") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const { shareId } = input as { shareId: string };
      await request<void>(ctx, `/v1/pages/shares/${pathSegment(shareId)}`, {
        method: "DELETE",
      });
      return { success: true };
    },
  });

  rl.registerAction("page.renderUrl", {
    access: "read",
    description: "Return the authenticated render URL for a page.",
    inputSchema: t.Object({ pageId: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { pageId } = input as { pageId: string };
      const body = await request<{
        page: { organizationId: string; slug: string };
      }>(ctx, `/v1/pages/${pathSegment(pageId)}`);
      return {
        url: pageRenderUrl(body.page.organizationId, body.page.slug),
      };
    },
  });
}
