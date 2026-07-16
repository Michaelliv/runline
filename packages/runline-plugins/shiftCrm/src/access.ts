import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  CRM_ACCESS_ROLE,
  CRM_BASE,
  type CrmAccessGrant,
  enumSchema,
  idSchema,
  listParams,
  pathSegment,
  request,
  STRICT_OBJECT,
  withQuery,
} from "./shared.js";

export function registerAccessActions(rl: RunlinePluginAPI) {
  rl.registerAction("access.me", {
    access: "read",
    description:
      "Resolve the caller's CRM access role (user, admin, or none). CRM data routes require a user principal with an active grant.",
    inputSchema: t.Object({}, STRICT_OBJECT),
    async execute(_input, ctx) {
      return request<{ role: string | null }>(ctx, `${CRM_BASE}/access/me`);
    },
  });

  rl.registerAction("access.list", {
    access: "read",
    description:
      "List CRM access grants. Requires a CRM admin grant or admin:* permission.",
    inputSchema: t.Object(
      { includeRevoked: t.Optional(t.Boolean()) },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ grants: CrmAccessGrant[] }>(
        ctx,
        withQuery(`${CRM_BASE}/access`, listParams(input)),
      );
      return body.grants;
    },
  });

  rl.registerAction("access.grant", {
    access: "write",
    description:
      "Grant a Shift user CRM access. Requires a CRM admin grant or admin:* permission.",
    inputSchema: t.Object(
      {
        userId: idSchema("Shift user ID to grant access to"),
        role: t.Optional(enumSchema("CRM access role", CRM_ACCESS_ROLE)),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const body = await request<{ grant: CrmAccessGrant }>(
        ctx,
        `${CRM_BASE}/access`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return body.grant;
    },
  });

  rl.registerAction("access.revoke", {
    access: "write",
    description:
      "Revoke a Shift user's CRM access grant. The grant is stamped revoked, not deleted.",
    inputSchema: t.Object({ userId: idSchema("Shift user ID") }, STRICT_OBJECT),
    async execute(input, ctx) {
      const { userId } = input as { userId: string };
      await request<void>(ctx, `${CRM_BASE}/access/${pathSegment(userId)}`, {
        method: "DELETE",
      });
      return { revoked: true };
    },
  });
}
