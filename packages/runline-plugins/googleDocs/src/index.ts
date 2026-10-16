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
import { googleCredential, googleOAuth } from "../../_shared/googleAuth.js";
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
  rl.setCredential(googleCredential("googleDocs", SCOPES));

  rl.setOAuth(googleOAuth("googleDocs", SCOPES, "GOOGLE_DOCS"));

  rl.setConnectionSchema({
    authMethod: {
      type: "string",
      required: false,
      description:
        "delegated or serviceAccount (legacy configs infer the method)",
    },
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
