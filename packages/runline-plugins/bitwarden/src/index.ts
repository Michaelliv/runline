import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { bitwardenCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function authedRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, bitwardenCredential, "bitwarden", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
      ? { json: body }
      : {}),
  });
}

export default function bitwarden(rl: RunlinePluginAPI) {
  rl.setName("bitwarden");
  rl.setVersion("0.1.0");
  rl.setCredential(bitwardenCredential);

  rl.setConnectionSchema({
    clientId: {
      type: "string",
      required: true,
      description: "Bitwarden API client ID",
      env: "BITWARDEN_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: true,
      description: "Bitwarden API client secret",
      env: "BITWARDEN_CLIENT_SECRET",
    },
    environment: {
      type: "string",
      required: false,
      description: "cloudHosted (default) or selfHosted",
      env: "BITWARDEN_ENVIRONMENT",
      default: "cloudHosted",
    },
    domain: {
      type: "string",
      required: false,
      description: "Self-hosted domain URL (only if environment=selfHosted)",
      env: "BITWARDEN_DOMAIN",
    },
  });

  // ── Collection ──────────────────────────────────────

  rl.registerAction("collection.get", {
    access: "read",
    description: "Get a collection by ID",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
    },
    async execute(input, ctx) {
      const { collectionId } = input as { collectionId: string };
      return authedRequest(ctx, "GET", `collections/${seg(collectionId)}`);
    },
  });

  rl.registerAction("collection.list", {
    access: "read",
    description: "List all collections",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await authedRequest(ctx, "GET", "collections")) as {
        data: unknown[];
      };
      if (limit) return data.data.slice(0, limit);
      return data.data;
    },
  });

  rl.registerAction("collection.update", {
    access: "write",
    description: "Update a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
      groups: {
        type: "array",
        required: false,
        description: "Array of group IDs to assign",
      },
      externalId: {
        type: "string",
        required: false,
        description: "External ID",
      },
    },
    async execute(input, ctx) {
      const { collectionId, groups, externalId } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (groups) {
        body.groups = (groups as string[]).map((id) => ({
          id,
          ReadOnly: false,
        }));
      }
      if (externalId) body.externalId = externalId;
      return authedRequest(
        ctx,
        "PUT",
        `collections/${seg(collectionId)}`,
        body,
      );
    },
  });

  rl.registerAction("collection.delete", {
    access: "write",
    description: "Delete a collection",
    inputSchema: {
      collectionId: {
        type: "string",
        required: true,
        description: "Collection ID",
      },
    },
    async execute(input, ctx) {
      const { collectionId } = input as { collectionId: string };
      await authedRequest(ctx, "DELETE", `collections/${seg(collectionId)}`);
      return { success: true };
    },
  });

  // ── Event ───────────────────────────────────────────

  rl.registerAction("event.list", {
    access: "read",
    description: "List organization events",
    inputSchema: {
      start: {
        type: "string",
        required: false,
        description: "Start date (ISO 8601)",
      },
      end: {
        type: "string",
        required: false,
        description: "End date (ISO 8601)",
      },
      actingUserId: {
        type: "string",
        required: false,
        description: "Filter by acting user ID",
      },
      itemId: {
        type: "string",
        required: false,
        description: "Filter by item ID",
      },
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit, ...qs } = (input ?? {}) as Record<string, unknown>;
      const data = (await authedRequest(
        ctx,
        "GET",
        "events",
        undefined,
        qs,
      )) as {
        data: unknown[];
      };
      if (limit) return data.data.slice(0, limit as number);
      return data.data;
    },
  });

  // ── Group ───────────────────────────────────────────

  rl.registerAction("group.create", {
    access: "write",
    description: "Create a group",
    inputSchema: {
      name: { type: "string", required: true, description: "Group name" },
      accessAll: {
        type: "boolean",
        required: true,
        description: "Grant access to all collections",
      },
      collections: {
        type: "array",
        required: false,
        description: "Array of collection IDs",
      },
      externalId: {
        type: "string",
        required: false,
        description: "External ID",
      },
    },
    async execute(input, ctx) {
      const { name, accessAll, collections, externalId } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = { name, AccessAll: accessAll };
      if (collections) {
        body.collections = (collections as string[]).map((id) => ({
          id,
          ReadOnly: false,
        }));
      }
      if (externalId) body.externalId = externalId;
      return authedRequest(ctx, "POST", "groups", body);
    },
  });

  rl.registerAction("group.get", {
    access: "read",
    description: "Get a group by ID",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
    },
    async execute(input, ctx) {
      const { groupId } = input as { groupId: string };
      return authedRequest(ctx, "GET", `groups/${seg(groupId)}`);
    },
  });

  rl.registerAction("group.list", {
    access: "read",
    description: "List all groups",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await authedRequest(ctx, "GET", "groups")) as {
        data: unknown[];
      };
      if (limit) return data.data.slice(0, limit);
      return data.data;
    },
  });

  rl.registerAction("group.getMembers", {
    access: "read",
    description: "Get member IDs for a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
    },
    async execute(input, ctx) {
      const { groupId } = input as { groupId: string };
      const memberIds = (await authedRequest(
        ctx,
        "GET",
        `groups/${seg(groupId)}/member-ids`,
      )) as string[];
      return memberIds.map((memberId) => ({ memberId }));
    },
  });

  rl.registerAction("group.update", {
    access: "write",
    description: "Update a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      name: { type: "string", required: false, description: "Group name" },
      accessAll: {
        type: "boolean",
        required: false,
        description: "Access all collections",
      },
      collections: {
        type: "array",
        required: false,
        description: "Array of collection IDs",
      },
      externalId: {
        type: "string",
        required: false,
        description: "External ID",
      },
    },
    async execute(input, ctx) {
      const { groupId, name, accessAll, collections, externalId } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};

      // Name is required by API — fetch current if not provided
      if (name) {
        body.name = name;
      } else {
        const current = (await authedRequest(
          ctx,
          "GET",
          `groups/${seg(groupId)}`,
        )) as { name: string };
        body.name = current.name;
      }

      body.AccessAll = accessAll ?? false;
      if (collections) {
        body.collections = (collections as string[]).map((id) => ({
          id,
          ReadOnly: false,
        }));
      }
      if (externalId) body.externalId = externalId;
      return authedRequest(ctx, "PUT", `groups/${seg(groupId)}`, body);
    },
  });

  rl.registerAction("group.updateMembers", {
    access: "write",
    description: "Set the member IDs for a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
      memberIds: {
        type: "array",
        required: true,
        description: "Array of member IDs",
      },
    },
    async execute(input, ctx) {
      const { groupId, memberIds } = input as {
        groupId: string;
        memberIds: string[];
      };
      await authedRequest(ctx, "PUT", `groups/${seg(groupId)}/member-ids`, {
        memberIds,
      });
      return { success: true };
    },
  });

  rl.registerAction("group.delete", {
    access: "write",
    description: "Delete a group",
    inputSchema: {
      groupId: { type: "string", required: true, description: "Group ID" },
    },
    async execute(input, ctx) {
      const { groupId } = input as { groupId: string };
      await authedRequest(ctx, "DELETE", `groups/${seg(groupId)}`);
      return { success: true };
    },
  });

  // ── Member ──────────────────────────────────────────

  rl.registerAction("member.create", {
    access: "write",
    description: "Invite a member to the organization",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address" },
      type: {
        type: "number",
        required: true,
        description: "Member type (0=Owner, 1=Admin, 2=User, 3=Manager)",
      },
      accessAll: {
        type: "boolean",
        required: true,
        description: "Access all collections",
      },
      collections: {
        type: "array",
        required: false,
        description: "Array of collection IDs",
      },
      externalId: {
        type: "string",
        required: false,
        description: "External ID",
      },
    },
    async execute(input, ctx) {
      const { email, type, accessAll, collections, externalId } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        email,
        type,
        AccessAll: accessAll,
      };
      if (collections) {
        body.collections = (collections as string[]).map((id) => ({
          id,
          ReadOnly: false,
        }));
      }
      if (externalId) body.externalId = externalId;
      return authedRequest(ctx, "POST", "members/", body);
    },
  });

  rl.registerAction("member.get", {
    access: "read",
    description: "Get a member by ID",
    inputSchema: {
      memberId: { type: "string", required: true, description: "Member ID" },
    },
    async execute(input, ctx) {
      const { memberId } = input as { memberId: string };
      return authedRequest(ctx, "GET", `members/${seg(memberId)}`);
    },
  });

  rl.registerAction("member.list", {
    access: "read",
    description: "List all members",
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
    },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const data = (await authedRequest(ctx, "GET", "members")) as {
        data: unknown[];
      };
      if (limit) return data.data.slice(0, limit);
      return data.data;
    },
  });

  rl.registerAction("member.getGroups", {
    access: "read",
    description: "Get group IDs for a member",
    inputSchema: {
      memberId: { type: "string", required: true, description: "Member ID" },
    },
    async execute(input, ctx) {
      const { memberId } = input as { memberId: string };
      const groupIds = (await authedRequest(
        ctx,
        "GET",
        `members/${seg(memberId)}/group-ids`,
      )) as string[];
      return groupIds.map((groupId) => ({ groupId }));
    },
  });

  rl.registerAction("member.update", {
    access: "write",
    description: "Update a member",
    inputSchema: {
      memberId: { type: "string", required: true, description: "Member ID" },
      type: {
        type: "number",
        required: false,
        description: "Member type (0=Owner, 1=Admin, 2=User, 3=Manager)",
      },
      accessAll: {
        type: "boolean",
        required: false,
        description: "Access all collections",
      },
      collections: {
        type: "array",
        required: false,
        description: "Array of collection IDs",
      },
      externalId: {
        type: "string",
        required: false,
        description: "External ID",
      },
    },
    async execute(input, ctx) {
      const { memberId, type, accessAll, collections, externalId } =
        input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (accessAll !== undefined) body.AccessAll = accessAll;
      if (type !== undefined) body.Type = type;
      if (collections) {
        body.collections = (collections as string[]).map((id) => ({
          id,
          ReadOnly: false,
        }));
      }
      if (externalId) body.externalId = externalId;
      return authedRequest(ctx, "PUT", `members/${seg(memberId)}`, body);
    },
  });

  rl.registerAction("member.updateGroups", {
    access: "write",
    description: "Set the group IDs for a member",
    inputSchema: {
      memberId: { type: "string", required: true, description: "Member ID" },
      groupIds: {
        type: "array",
        required: true,
        description: "Array of group IDs",
      },
    },
    async execute(input, ctx) {
      const { memberId, groupIds } = input as {
        memberId: string;
        groupIds: string[];
      };
      await authedRequest(ctx, "PUT", `members/${seg(memberId)}/group-ids`, {
        groupIds,
      });
      return { success: true };
    },
  });

  rl.registerAction("member.delete", {
    access: "write",
    description: "Remove a member from the organization",
    inputSchema: {
      memberId: { type: "string", required: true, description: "Member ID" },
    },
    async execute(input, ctx) {
      const { memberId } = input as { memberId: string };
      await authedRequest(ctx, "DELETE", `members/${seg(memberId)}`);
      return { success: true };
    },
  });
}
