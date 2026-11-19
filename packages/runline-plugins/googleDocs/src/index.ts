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
import * as t from "typebox";
import { googleCredential, googleOAuth } from "../../_shared/googleAuth.js";
import { googleConnection } from "../../_shared/googleSchemas.js";
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

  rl.setConnectionSchema(t.Object(googleConnection("GOOGLE_DOCS")));

  registerDocumentsActions(rl);
  registerTextActions(rl);
  registerTablesActions(rl);
  registerTabActions(rl);
  registerStructureActions(rl);
  registerFormattingActions(rl);
  registerImagesActions(rl);
}
