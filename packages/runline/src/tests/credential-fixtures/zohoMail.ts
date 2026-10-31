import zohoMail from "../../../../runline-plugins/zohoMail/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zohoMail,
  name: "zohoMail",
  config: {
    dc: "eu",
    clientId: "zoho_client",
    clientSecret: "zoho_secret",
    refreshToken: "zoho_refresh",
    accessToken: "zoho_access",
    accountId: "123",
  },
  secrets: ["clientSecret", "refreshToken", "accessToken"],
  action: "message.list",
  input: { folderId: "456", limit: 10 },
  response: { status: { code: 200 }, data: [] },
  target: "api",
  wire: {
    url: "https://mail.zoho.eu/api/accounts/123/messages/view?folderId=456&limit=10",
    header: ["authorization", "Bearer zoho_access"],
  },
} satisfies CredentialFixture;
