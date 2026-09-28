import {
  hostLabel,
  httpsBase,
  staticCredential,
} from "../../_shared/credentials.js";

/**
 * A Data API token, sent as a bearer to the app's own base: the app's
 * bubbleapps.io host, or the self-hosted domain, with the version-test
 * path prefix when the connection targets the development environment.
 * A self-hosted connection must name its HTTPS domain; it is never sent
 * to bubbleapps.io instead.
 */
export const bubbleCredential = staticCredential({
  id: "bubble",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: (config) => {
    const path =
      config.environment === "development"
        ? "version-test/api/1.1/"
        : "api/1.1/";
    const baseUrl =
      config.hosting === "selfHosted"
        ? httpsBase(config.domain, path)
        : `https://${hostLabel(config.appName)}.bubbleapps.io/${path}`;
    return {
      api: {
        baseUrl,
        methods: ["GET", "POST", "PATCH", "DELETE"],
      },
    };
  },
});
