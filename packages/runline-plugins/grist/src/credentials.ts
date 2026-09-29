import {
  configChoice,
  hostLabel,
  httpsBase,
  staticCredential,
} from "../../_shared/credentials.js";

/**
 * An API key, sent as a bearer to the plan's one API origin: docs.getgrist.com
 * (free), the team subdomain (paid), or the self-hosted instance.
 */
export const gristCredential = staticCredential({
  id: "grist",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => {
    const planType = configChoice(
      config.planType,
      ["free", "paid", "selfHosted"],
      "free",
    );
    const baseUrl =
      planType === "selfHosted"
        ? httpsBase(config.selfHostedUrl, "api/")
        : planType === "paid"
          ? `https://${hostLabel(config.subdomain)}.getgrist.com/api/`
          : "https://docs.getgrist.com/api/";
    return {
      api: {
        baseUrl,
        methods: ["GET", "POST", "PATCH"],
      },
    };
  },
  probe: {
    target: "api",
    path: "orgs",
    method: "GET",
    acceptedStatuses: [200],
  },
});
