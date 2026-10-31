import paddle from "../../../../runline-plugins/paddle/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: paddle,
  name: "paddle",
  config: { vendorId: "v1", vendorAuthCode: "pd_code" },
  secrets: ["vendorId", "vendorAuthCode"],
  action: "plan.get",
  input: { planId: "p1" },
  response: { success: true, response: [{ id: "p1" }] },
  target: "api",
  wire: {
    url: "https://vendors.paddle.com/api/2.0/subscription/plans",
    field: ["vendor_auth_code", "pd_code"],
  },
} satisfies CredentialFixture;
