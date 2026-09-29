import type { ActionContext } from "runline";
import { baseUrl, pathSegment } from "../../_shared/shiftCloud.js";
import { shiftClient } from "../../_shared/shiftCredentials.js";

export {
  enumSchema,
  idSchema,
  pathSegment,
  STRICT_OBJECT,
  timestampSchema,
} from "../../_shared/shiftCloud.js";

export type Ctx = ActionContext;

export const { credential: shiftPagesCredential, request } =
  shiftClient("shiftPages");

export const PAGE_STATUS = ["draft", "published", "archived"] as const;
export const PAGE_TYPE = [
  "hosted_html",
  "protected_origin",
  "vex_artifact",
] as const;
export const PAGE_VISIBILITY = ["org", "invited"] as const;

export function pageRenderUrl(organizationId: string, slug: string): string {
  return new URL(
    `/pages/${pathSegment(organizationId)}/${pathSegment(slug)}`,
    baseUrl(),
  ).toString();
}
