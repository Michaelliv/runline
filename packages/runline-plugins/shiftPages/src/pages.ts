import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  enumSchema,
  idSchema,
  listParams,
  PAGE_STATUS,
  PAGE_TYPE,
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
  type: (typeof PAGE_TYPE)[number];
  status: (typeof PAGE_STATUS)[number];
  visibility: (typeof PAGE_VISIBILITY)[number];
  html?: string;
  originUrl?: string;
  deploymentId?: string;
  artifactId?: string;
  createdByUserId?: string;
  updatedByUserId?: string;
  publishedAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftVexArtifact {
  id: string;
  workspaceId: string;
  workspaceName: string;
  title: string;
  version: number;
  enabled: boolean;
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

const OriginUrl = t.String({
  minLength: 1,
  format: "uri",
  pattern: "^https://",
  description:
    "HTTPS origin to proxy behind SSO (protected_origin pages only). " +
    "Localhost and private IP hosts are rejected.",
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

  rl.registerAction("page.vexArtifacts", {
    access: "read",
    description:
      "List the shareable Vex artifacts on a managed deployment, sorted by " +
      "title, each carrying the workspace it belongs to. Pass an artifact's " +
      "ID to page.create with type vex_artifact to publish it. The " +
      "deployment must belong to the API key's organization.",
    inputSchema: t.Object(
      { deploymentId: idSchema("Managed Vex deployment ID") },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ artifacts: ShiftVexArtifact[] }>(
        ctx,
        withQuery("/v1/pages/vex-artifacts", listParams(input)),
      );
      return body.artifacts;
    },
  });

  rl.registerAction("page.create", {
    access: "write",
    description:
      "Create a draft page and publish it with page.publish. hosted_html " +
      "pages carry their own HTML; vex_artifact pages render a live Vex " +
      "artifact (pass deploymentId and artifactId from page.vexArtifacts).",
    inputSchema: t.Object(
      {
        slug: PageSlug,
        title: t.String({
          minLength: 1,
          maxLength: 160,
          pattern: "\\S",
          description: "Page title",
        }),
        type: t.Optional(enumSchema("Page type", PAGE_TYPE)),
        html: t.Optional(
          t.String({
            maxLength: 1_000_000,
            description: "Hosted HTML content (hosted_html pages only)",
          }),
        ),
        originUrl: t.Optional(OriginUrl),
        deploymentId: t.Optional(
          idSchema("Managed Vex deployment ID (vex_artifact pages only)"),
        ),
        artifactId: t.Optional(
          idSchema("Vex artifact ID (vex_artifact pages only)"),
        ),
        visibility: t.Optional(enumSchema("Page visibility", PAGE_VISIBILITY)),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const fields = input as Record<string, unknown>;
      assertPageContent(fields);
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
      "Update a page's slug, title, visibility, HTML, or — for vex_artifact " +
      "pages — which deployment and artifact it renders. A page's type is " +
      "fixed at creation.",
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
            description: "Hosted HTML content (hosted_html pages only)",
          }),
        ),
        originUrl: t.Optional(OriginUrl),
        deploymentId: t.Optional(
          idSchema("Managed Vex deployment ID (vex_artifact pages only)"),
        ),
        artifactId: t.Optional(
          idSchema("Vex artifact ID (vex_artifact pages only)"),
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
    description:
      "Publish a draft page, making it reachable at its render URL by the " +
      "organization (or by invited viewers when visibility is invited).",
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
    inputSchema: t.Object({ id: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{ shares: ShiftPageShare[] }>(
        ctx,
        `/v1/pages/${pathSegment(id)}/shares`,
      );
      return body.shares;
    },
  });

  rl.registerAction("page.share", {
    access: "write",
    description: "Create a viewer share for a Shift Labs page.",
    inputSchema: t.Object(
      {
        id: idSchema("Page ID"),
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
      const { id, ...fields } = input as Record<string, unknown>;
      const body = await request<{ share: ShiftPageShare }>(
        ctx,
        `/v1/pages/${pathSegment(String(id))}/shares`,
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
    inputSchema: t.Object({ id: idSchema("Page ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { id } = input as { id: string };
      const body = await request<{
        page: { organizationId: string; slug: string };
      }>(ctx, `/v1/pages/${pathSegment(id)}`);
      return {
        url: pageRenderUrl(body.page.organizationId, body.page.slug),
      };
    },
  });
}

/**
 * The content rules the API enforces per page type, checked before the
 * round-trip so a caller gets the reason rather than a bare 400. Each
 * type owns exactly one content field.
 */
function assertPageContent(fields: Record<string, unknown>): void {
  const type = (fields.type as string | undefined) ?? "hosted_html";
  const referencesArtifact =
    fields.deploymentId !== undefined || fields.artifactId !== undefined;

  if (type !== "vex_artifact" && referencesArtifact) {
    throw new Error(
      "Only vex_artifact pages may reference a deployment or artifact",
    );
  }
  if (type !== "protected_origin" && fields.originUrl !== undefined) {
    throw new Error("Only protected_origin pages may set an originUrl");
  }
  if (type !== "hosted_html" && fields.html !== undefined) {
    throw new Error("Only hosted_html pages may carry html");
  }

  if (
    type === "vex_artifact" &&
    (fields.deploymentId === undefined || fields.artifactId === undefined)
  ) {
    throw new Error(
      "vex_artifact pages require both deploymentId and artifactId",
    );
  }
  if (type === "protected_origin" && fields.originUrl === undefined) {
    throw new Error("protected_origin pages require an originUrl");
  }
}
