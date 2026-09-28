import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import {
  credentialJson,
  pathSegment,
  pathSegments,
} from "../../_shared/credentials.js";
import { storyblokCredential } from "./credentials.js";

function contentApi(
  ctx: ActionContext,
  path: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, storyblokCredential, "storyblok", {
    target: "content",
    path,
    query,
  });
}

function managementApi(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, storyblokCredential, "storyblok", {
    target: "management",
    path,
    method,
    query,
  });
}

export default function storyblok(rl: RunlinePluginAPI) {
  rl.setName("storyblok");
  rl.setVersion("0.1.0");
  rl.setCredential(storyblokCredential);

  rl.setConnectionSchema({
    contentToken: {
      type: "string",
      required: false,
      description:
        "Storyblok Content Delivery API token (for reading published content)",
      env: "STORYBLOK_CONTENT_TOKEN",
    },
    managementToken: {
      type: "string",
      required: false,
      description: "Storyblok Management API personal access token",
      env: "STORYBLOK_MANAGEMENT_TOKEN",
    },
  });

  // ── Content API ─────────────────────────────────────

  rl.registerAction("content.story.get", {
    access: "read",
    description: "Get a published story by slug or ID (Content API)",
    inputSchema: {
      identifier: {
        type: "string",
        required: true,
        description: "Story slug or numeric ID",
      },
    },
    async execute(input, ctx) {
      const data = (await contentApi(
        ctx,
        `stories/${pathSegments((input as Record<string, unknown>).identifier)}`,
      )) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("content.story.list", {
    access: "read",
    description: "List published stories (Content API)",
    inputSchema: {
      limit: { type: "number", required: false },
      startsWith: {
        type: "string",
        required: false,
        description: "Filter by slug prefix",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      if (p.startsWith) qs.starts_with = p.startsWith;
      const data = (await contentApi(ctx, "stories", qs)) as Record<
        string,
        unknown
      >;
      return data.stories;
    },
  });

  // ── Management API ──────────────────────────────────

  rl.registerAction("management.story.get", {
    access: "read",
    description: "Get a story by ID (Management API)",
    inputSchema: {
      spaceId: { type: "string", required: true },
      storyId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await managementApi(
        ctx,
        "GET",
        `${pathSegment(p.spaceId)}/stories/${pathSegment(p.storyId)}`,
      )) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.list", {
    access: "read",
    description: "List stories in a space (Management API)",
    inputSchema: {
      spaceId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.limit) qs.per_page = p.limit;
      const data = (await managementApi(
        ctx,
        "GET",
        `${pathSegment(p.spaceId)}/stories`,
        qs,
      )) as Record<string, unknown>;
      return data.stories;
    },
  });

  rl.registerAction("management.story.delete", {
    access: "write",
    description: "Delete a story (Management API)",
    inputSchema: {
      spaceId: { type: "string", required: true },
      storyId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await managementApi(
        ctx,
        "DELETE",
        `${pathSegment(p.spaceId)}/stories/${pathSegment(p.storyId)}`,
      )) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.publish", {
    access: "write",
    description: "Publish a story (Management API)",
    inputSchema: {
      spaceId: { type: "string", required: true },
      storyId: { type: "string", required: true },
      releaseId: { type: "string", required: false },
      language: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.releaseId) qs.release_id = p.releaseId;
      if (p.language) qs.lang = p.language;
      const data = (await managementApi(
        ctx,
        "GET",
        `${pathSegment(p.spaceId)}/stories/${pathSegment(p.storyId)}/publish`,
        qs,
      )) as Record<string, unknown>;
      return data.story;
    },
  });

  rl.registerAction("management.story.unpublish", {
    access: "write",
    description: "Unpublish a story (Management API)",
    inputSchema: {
      spaceId: { type: "string", required: true },
      storyId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await managementApi(
        ctx,
        "GET",
        `${pathSegment(p.spaceId)}/stories/${pathSegment(p.storyId)}/unpublish`,
      )) as Record<string, unknown>;
      return data.story;
    },
  });
}
