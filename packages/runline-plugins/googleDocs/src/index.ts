/**
 * Google Docs plugin for runline.
 *
 * OAuth2 user flow, same shape as the rest of the Google plugins.
 * Scopes: `auth/documents` for docs; `auth/drive.file` is added
 * because `document.create` goes through Drive's files endpoint
 * — the Docs API itself only creates blank documents without a
 * target folder.
 */

import type { RunlinePluginAPI } from "runline";
import { registerDocumentsActions } from "./documents.js";
import { registerFormattingActions } from "./formatting.js";
import { registerImagesActions } from "./images.js";
import { SCOPES } from "./shared.js";
import { registerStructureActions } from "./structure.js";
import { registerTablesActions } from "./tables.js";
import { registerTabActions } from "./tabs.js";
import { registerTextActions } from "./text.js";

export default function googleDocs(rl: RunlinePluginAPI) {
  rl.setName("googleDocs");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the Google Docs API (and Drive API for document.create):",
      "     https://console.cloud.google.com/apis/library/docs.googleapis.com",
      "     https://console.cloud.google.com/apis/library/drive.googleapis.com",
      "",
      "3. Configure the OAuth consent screen:",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_DOCS_CLIENT_ID and GOOGLE_DOCS_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, env: "GOOGLE_DOCS_CLIENT_ID" },
    clientSecret: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_CLIENT_SECRET",
    },
    refreshToken: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_REFRESH_TOKEN",
    },
    serviceAccountJson: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_SERVICE_ACCOUNT_JSON",
    },
    serviceAccountEmail: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_SERVICE_ACCOUNT_EMAIL",
    },
    serviceAccountPrivateKey: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_SERVICE_ACCOUNT_PRIVATE_KEY",
    },
    serviceAccountSubject: {
      type: "string",
      required: false,
      env: "GOOGLE_DOCS_SERVICE_ACCOUNT_SUBJECT",
    },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  registerDocumentsActions(rl);
  registerTextActions(rl);
  registerTablesActions(rl);
  registerTabActions(rl);
  registerStructureActions(rl);
  registerFormattingActions(rl);
  registerImagesActions(rl);
}
