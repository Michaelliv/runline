import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A plugin request that carries a credential must not follow redirects: a
 * redirect hands the `Authorization` header — or an API key in the query
 * string — to whatever host the response names. The credential registry's own
 * transport refuses redirects for this reason (runline/src/credentials/http.ts);
 * `_shared/authedFetch.ts` is the same guarantee for plugins that hand-roll
 * their calls, which is nearly all of them.
 *
 * This gate is a ratchet, not an audit: it cannot tell which call site in a
 * file carries the credential, so it asks only that a file making requests has
 * the helper in hand. `BARE_FETCH_BACKLOG` lists the files that predate it.
 * The list may shrink and must never grow — a new plugin cannot join it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(here, "..", "..", "..", "runline-plugins");

/**
 * Registry-backed plugins route through CredentialTransport, which already
 * refuses redirects, and pass `globalThis.fetch` to it by design.
 */
const REGISTRY_BACKED = new Set([
  "_shared/authedFetch.ts",
  "_shared/credentialAdapter.ts",
  "_shared/googleAuth.ts",
  "_shared/microsoftAuth.ts",
  "plaud/src/shared.ts",
]);

function pluginSources(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(PLUGINS)) {
    if (entry === "dist" || entry === "node_modules" || entry === "icons")
      continue;
    const dir = join(PLUGINS, entry);
    if (!statSync(dir).isDirectory()) continue;
    const roots = entry === "_shared" ? [dir] : [join(dir, "src")];
    for (const root of roots) {
      let names: string[];
      try {
        names = readdirSync(root);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".ts")) continue;
        const full = join(root, name);
        if (!statSync(full).isFile()) continue;
        out.push(
          entry === "_shared" ? `_shared/${name}` : `${entry}/src/${name}`,
        );
      }
    }
  }
  return out.sort();
}

/** `fetch(` as a call, not `options.fetch` or a `fetch:` property. */
const CALLS_FETCH = /(?<![.\w$])fetch\s*\(/;

function filesCallingBareFetch(): string[] {
  return pluginSources().filter((rel) => {
    if (REGISTRY_BACKED.has(rel)) return false;
    const text = readFileSync(join(PLUGINS, rel), "utf-8");
    if (!CALLS_FETCH.test(text)) return false;
    return !text.includes("authedFetch");
  });
}

/**
 * Files that call `fetch` without the helper in hand, as committed. Most send
 * a credential on at least some of their requests, so most are a redirect away
 * from handing it to another host.
 *
 * Written out rather than computed, because a computed list would compare
 * itself against itself and pass forever. Shrinking it is the work; a file not
 * on it fails the gate.
 */
const BARE_FETCH_BACKLOG = new Set([
  "_shared/shiftCloud.ts",
  "_shared/shiftUpload.ts",
  "actionNetwork/src/index.ts",
  "activeCampaign/src/index.ts",
  "adalo/src/index.ts",
  "affinity/src/index.ts",
  "agileCrm/src/index.ts",
  "airtable/src/index.ts",
  "airtop/src/index.ts",
  "apiTemplateIo/src/index.ts",
  "asana/src/index.ts",
  "autopilot/src/index.ts",
  "bambooHr/src/index.ts",
  "bannerbear/src/index.ts",
  "baserow/src/index.ts",
  "beeminder/src/index.ts",
  "bitly/src/index.ts",
  "bitwarden/src/index.ts",
  "box/src/index.ts",
  "brandfetch/src/index.ts",
  "brevo/src/index.ts",
  "bubble/src/index.ts",
  "chargebee/src/index.ts",
  "circleci/src/index.ts",
  "ciscoWebex/src/index.ts",
  "clearbit/src/index.ts",
  "clickup/src/index.ts",
  "clockify/src/index.ts",
  "cloudflare/src/index.ts",
  "cockpit/src/index.ts",
  "coda/src/index.ts",
  "coingecko/src/index.ts",
  "contentful/src/index.ts",
  "convertkit/src/index.ts",
  "copper/src/index.ts",
  "cortex/src/index.ts",
  "currents/src/index.ts",
  "customerIo/src/index.ts",
  "databricks/src/index.ts",
  "deepl/src/index.ts",
  "demio/src/index.ts",
  "dhl/src/index.ts",
  "discord/src/index.ts",
  "discourse/src/index.ts",
  "disqus/src/index.ts",
  "drift/src/index.ts",
  "dropbox/src/index.ts",
  "dropcontact/src/index.ts",
  "egoi/src/index.ts",
  "elasticsearch/src/index.ts",
  "emelia/src/index.ts",
  "erpnext/src/index.ts",
  "facebookGraph/src/index.ts",
  "freshdesk/src/index.ts",
  "freshservice/src/index.ts",
  "freshworksCrm/src/index.ts",
  "getresponse/src/index.ts",
  "ghost/src/index.ts",
  "github/src/index.ts",
  "gitlab/src/index.ts",
  "gong/src/index.ts",
  "googleImage/src/index.ts",
  "gotify/src/index.ts",
  "gotowebinar/src/index.ts",
  "grafana/src/index.ts",
  "graphql/src/index.ts",
  "grist/src/index.ts",
  "hackernews/src/index.ts",
  "halopsa/src/index.ts",
  "harvest/src/index.ts",
  "helpscout/src/index.ts",
  "highlevel/src/index.ts",
  "homeAssistant/src/index.ts",
  "hubspot/src/index.ts",
  "humanticAi/src/index.ts",
  "hunter/src/index.ts",
  "intercom/src/index.ts",
  "iterable/src/index.ts",
  "jenkins/src/index.ts",
  "jira/src/index.ts",
  "keap/src/index.ts",
  "kobotoolbox/src/index.ts",
  "lemlist/src/index.ts",
  "lingvanex/src/index.ts",
  "linkedin/src/index.ts",
  "lonescale/src/index.ts",
  "magento/src/index.ts",
  "mailcheck/src/index.ts",
  "mailchimp/src/index.ts",
  "mailerlite/src/index.ts",
  "mailgun/src/index.ts",
  "mailjet/src/index.ts",
  "mandrill/src/index.ts",
  "marketstack/src/index.ts",
  "matrix/src/index.ts",
  "mattermost/src/index.ts",
  "mautic/src/index.ts",
  "medium/src/index.ts",
  "messagebird/src/index.ts",
  "metabase/src/index.ts",
  "misp/src/index.ts",
  "mocean/src/index.ts",
  "monday/src/index.ts",
  "monicaCrm/src/index.ts",
  "msg91/src/index.ts",
  "nasa/src/index.ts",
  "netlify/src/index.ts",
  "netscalerAdc/src/index.ts",
  "nextcloud/src/index.ts",
  "nocodb/src/index.ts",
  "node/src/index.ts",
  "notion/src/index.ts",
  "npm/src/index.ts",
  "odoo/src/index.ts",
  "okta/src/index.ts",
  "oneSimpleApi/src/index.ts",
  "onfleet/src/index.ts",
  "openThesaurus/src/index.ts",
  "openai/src/index.ts",
  "openweathermap/src/index.ts",
  "oura/src/index.ts",
  "paddle/src/index.ts",
  "pagerduty/src/index.ts",
  "parallel/src/index.ts",
  "paypal/src/index.ts",
  "peekalink/src/index.ts",
  "phantombuster/src/index.ts",
  "philipsHue/src/index.ts",
  "pipedrive/src/index.ts",
  "plivo/src/index.ts",
  "postbin/src/index.ts",
  "posthog/src/index.ts",
  "profitwell/src/index.ts",
  "pushbullet/src/index.ts",
  "pushcut/src/index.ts",
  "pushover/src/index.ts",
  "quickbase/src/index.ts",
  "quickbooks/src/index.ts",
  "raindrop/src/index.ts",
  "recraft/src/index.ts",
  "reddit/src/index.ts",
  "replicate/src/index.ts",
  "rocketchat/src/index.ts",
  "rundeck/src/index.ts",
  "salesforce/src/shared.ts",
  "salesmate/src/index.ts",
  "securityScorecard/src/index.ts",
  "segment/src/index.ts",
  "sendgrid/src/index.ts",
  "sendy/src/index.ts",
  "sentry/src/index.ts",
  "servicenow/src/index.ts",
  "shiftObjects/src/objects.ts",
  "shiftTranscription/src/transcription.ts",
  "shopify/src/index.ts",
  "signl4/src/index.ts",
  "slack/src/index.ts",
  "sms77/src/index.ts",
  "splunk/src/index.ts",
  "spotify/src/index.ts",
  "stackby/src/index.ts",
  "steel/src/shared.ts",
  "storyblok/src/index.ts",
  "strapi/src/index.ts",
  "strava/src/index.ts",
  "stripe/src/index.ts",
  "supabase/src/index.ts",
  "syncromsp/src/index.ts",
  "tapfiliate/src/index.ts",
  "telegram/src/index.ts",
  "thehive/src/index.ts",
  "thehiveProject/src/index.ts",
  "todoist/src/index.ts",
  "together/src/index.ts",
  "travisci/src/index.ts",
  "trello/src/index.ts",
  "twake/src/index.ts",
  "twilio/src/index.ts",
  "twist/src/index.ts",
  "twitter/src/index.ts",
  "typesafe/src/shared.ts",
  "unleashedSoftware/src/index.ts",
  "uplead/src/index.ts",
  "uproc/src/index.ts",
  "uptimerobot/src/index.ts",
  "urlscanio/src/index.ts",
  "vercel/src/shared.ts",
  "vero/src/index.ts",
  "vonage/src/index.ts",
  "wekan/src/index.ts",
  "woocommerce/src/index.ts",
  "wordpress/src/index.ts",
  "xai/src/index.ts",
  "xero/src/index.ts",
  "yourls/src/index.ts",
  "zammad/src/index.ts",
  "zendesk/src/index.ts",
  "zoho/src/index.ts",
  "zoom/src/index.ts",
  "zulip/src/index.ts",
]);

describe("plugin requests carrying credentials refuse redirects", () => {
  it("has a helper that pins the redirect and rejects a redirected response", async () => {
    const { authedFetch } = await import(
      "../../../runline-plugins/_shared/authedFetch.js"
    );
    const original = globalThis.fetch;
    try {
      let seen: RequestInit | undefined;
      globalThis.fetch = (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        seen = init;
        return new Response("{}", { status: 200 });
      }) as typeof fetch;
      await authedFetch("https://example.test/x", {
        headers: { Authorization: "secret" },
      });
      assert.equal(seen?.redirect, "error");

      // Belt to that brace: a fetch that ignores the option must not slip past.
      globalThis.fetch = (async () => {
        const redirected = new Response("{}", { status: 200 });
        Object.defineProperty(redirected, "redirected", { value: true });
        return redirected;
      }) as typeof fetch;
      await assert.rejects(
        authedFetch("https://example.test/x"),
        /followed a redirect/,
      );

      // A 3xx handed back rather than followed is refused on its own terms.
      globalThis.fetch = (async () =>
        new Response(null, { status: 302 })) as typeof fetch;
      await assert.rejects(
        authedFetch("https://example.test/x"),
        /Refusing a redirect .*HTTP 302/,
      );
    } finally {
      globalThis.fetch = original;
    }
  });

  it("no plugin joins the bare-fetch backlog", () => {
    const offenders = filesCallingBareFetch().filter(
      (rel) => !BARE_FETCH_BACKLOG.has(rel),
    );
    assert.deepEqual(
      offenders,
      [],
      `These files call fetch without importing authedFetch from _shared/authedFetch.js. ` +
        `A request carrying a credential must not follow redirects.`,
    );
  });

  it("drops a file from the backlog as soon as it is migrated", () => {
    // Without this the list rots: a migrated file keeps its line, the gate
    // still passes, and the backlog stops describing the work that is left.
    const offenders = new Set(filesCallingBareFetch());
    const stale = [...BARE_FETCH_BACKLOG].filter((rel) => !offenders.has(rel));
    assert.deepEqual(
      stale,
      [],
      "these files now use authedFetch; delete their lines from BARE_FETCH_BACKLOG",
    );
  });

  it("still has a backlog, so a broken detector cannot look like finished work", () => {
    assert.ok(
      BARE_FETCH_BACKLOG.size > 0,
      "a zero-sized backlog means the detector stopped matching, not that the work is done",
    );
    for (const rel of BARE_FETCH_BACKLOG) {
      assert.ok(
        !REGISTRY_BACKED.has(rel),
        `${rel} is registry-backed and should not be in the backlog`,
      );
    }
  });
});
