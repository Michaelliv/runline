/**
 * Every bundled plugin that carries a credential signs through its declared
 * credential, or is on a written-out list saying why not yet.
 *
 * Each plugin directory is in exactly one of three places:
 *   - it declares its credential (`rl.setCredential`) and has a fixture in
 *     credential-fixtures/, exercised by credential-plugins.test.ts;
 *   - UNDECLARED_BACKLOG, with the phase it belongs to or the specific
 *     reason it cannot be declared with today's authentication kinds;
 *   - NO_CREDENTIAL, with the reason it holds no secret at all.
 *
 * Like plugin-authed-fetch.test.ts, this is a ratchet: the backlog may
 * shrink and must never grow, a migrated plugin must leave it, and a new
 * plugin cannot join it. The lists are written out rather than computed,
 * because a computed list would compare itself against itself.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PLUGINS = join(here, "..", "..", "..", "runline-plugins");
const FIXTURES = join(here, "credential-fixtures");

/** Plugins that hold no secret, and why. */
const NO_CREDENTIAL = new Map<string, string>([
  ["docker", "local docker CLI via syncExec; no network, no secret"],
  ["hackernews", "public Algolia and Firebase APIs; empty connection schema"],
  [
    "node",
    "local fs/process utilities; its fetch action sends caller-supplied headers, no connection secret",
  ],
  ["openThesaurus", "public API; empty connection schema"],
  ["postbin", "public API; empty connection schema"],
  ["quickchart", "builds a public chart URL; makes no request"],
]);

/** Plugins that carry a credential but do not declare it yet, and why. */
const UNDECLARED_BACKLOG = new Map<string, string>([
  ["actionNetwork", "phase 3: not yet migrated"],
  ["activeCampaign", "phase 3: not yet migrated"],
  ["adalo", "phase 3: not yet migrated"],
  ["affinity", "phase 2: not yet migrated"],
  ["agileCrm", "phase 2: not yet migrated"],
  ["airtable", "phase 2: not yet migrated"],
  ["airtop", "phase 3: not yet migrated"],
  ["apiTemplateIo", "phase 3: not yet migrated"],
  ["asana", "phase 2: not yet migrated"],
  ["autopilot", "phase 3: not yet migrated"],
  ["bambooHr", "phase 2: not yet migrated"],
  ["bannerbear", "phase 3: not yet migrated"],
  ["baserow", "phase 3: not yet migrated"],
  ["beeminder", "phase 2: not yet migrated"],
  ["bitly", "phase 2: not yet migrated"],
  ["bitwarden", "phase 3: not yet migrated"],
  ["box", "phase 2: not yet migrated"],
  ["brandfetch", "phase 3: not yet migrated"],
  ["brevo", "phase 3: not yet migrated"],
  ["bubble", "phase 3: not yet migrated"],
  ["chargebee", "phase 3: not yet migrated"],
  ["circleci", "phase 2: not yet migrated"],
  ["ciscoWebex", "phase 2: not yet migrated"],
  ["clearbit", "phase 3: not yet migrated"],
  ["clickup", "phase 2: not yet migrated"],
  ["clockify", "phase 2: not yet migrated"],
  ["cloudflare", "phase 3: not yet migrated"],
  ["cockpit", "phase 3: not yet migrated"],
  [
    "coingecko",
    "optional credential: a secret-free config cannot say whether to sign",
  ],
  ["contentful", "phase 3: not yet migrated"],
  [
    "convertkit",
    "body key: api_secret travels in the JSON body of every write",
  ],
  ["copper", "phase 2: not yet migrated"],
  ["cortex", "phase 3: not yet migrated"],
  ["currents", "phase 3: not yet migrated"],
  [
    "customerIo",
    "two credentials in one connection: tracking and app keys, used by different actions",
  ],
  ["deepl", "phase 3: not yet migrated"],
  ["demio", "two secrets per request: Api-Key and Api-Secret headers"],
  ["dhl", "phase 3: not yet migrated"],
  ["discord", "phase 3: not yet migrated"],
  ["discourse", "phase 3: not yet migrated"],
  ["drift", "phase 3: not yet migrated"],
  ["dropbox", "phase 2: not yet migrated"],
  ["dropcontact", "phase 3: not yet migrated"],
  ["egoi", "phase 3: not yet migrated"],
  ["elasticsearch", "phase 3: not yet migrated"],
  ["elevenlabs", "phase 3: not yet migrated"],
  ["emelia", "phase 3: not yet migrated"],
  [
    "erpnext",
    "composite secret: Authorization: token {apiKey}:{apiSecret} joins two fields",
  ],
  [
    "facebookGraph",
    "agent-selected host: hostUrl is a per-call action input, not config",
  ],
  ["fal", "phase 3: not yet migrated"],
  ["freshdesk", "phase 2: not yet migrated"],
  ["freshservice", "phase 2: not yet migrated"],
  ["freshworksCrm", "phase 2: not yet migrated"],
  ["getresponse", "phase 3: not yet migrated"],
  ["gett", "login: phone OTP login and a rotating, device-bound refresh grant"],
  ["ghost", "signature: a JWT is minted per request from the admin key"],
  ["github", "phase 2: not yet migrated"],
  ["gitlab", "phase 2: not yet migrated"],
  ["gong", "phase 3: not yet migrated"],
  ["googleImage", "phase 3: not yet migrated"],
  [
    "gotify",
    "two credentials in one connection: app and client tokens, used by different actions",
  ],
  ["gotowebinar", "phase 2: not yet migrated"],
  ["grafana", "phase 3: not yet migrated"],
  [
    "graphql",
    "generic client: arbitrary endpoint and caller-composed auth header",
  ],
  ["grist", "phase 2: not yet migrated"],
  ["halopsa", "phase 3: not yet migrated"],
  ["harvest", "phase 2: not yet migrated"],
  ["helpscout", "phase 3: not yet migrated"],
  ["highlevel", "phase 3: not yet migrated"],
  ["homeAssistant", "phase 2: not yet migrated"],
  ["hubspot", "phase 3: not yet migrated"],
  ["humanticAi", "phase 3: not yet migrated"],
  ["hunter", "phase 3: not yet migrated"],
  ["intercom", "phase 3: not yet migrated"],
  ["iterable", "phase 3: not yet migrated"],
  ["jenkins", "phase 2: not yet migrated"],
  ["jira", "phase 2: not yet migrated"],
  ["keap", "phase 2: not yet migrated"],
  ["kobotoolbox", "phase 2: not yet migrated"],
  ["lemlist", "phase 3: not yet migrated"],
  ["linear", "phase 2: not yet migrated"],
  ["lingvanex", "phase 3: not yet migrated"],
  ["linkedin", "phase 2: not yet migrated"],
  ["lonescale", "phase 3: not yet migrated"],
  ["magento", "phase 3: not yet migrated"],
  ["mailcheck", "phase 3: not yet migrated"],
  ["mailchimp", "phase 2: not yet migrated"],
  ["mailerlite", "phase 3: not yet migrated"],
  ["mailgun", "phase 3: not yet migrated"],
  [
    "mailjet",
    "two credentials in one connection: basic pair for email, bearer for SMS",
  ],
  ["mandrill", "body key: key travels in the JSON body of every call"],
  ["marketstack", "phase 3: not yet migrated"],
  ["matrix", "phase 2: not yet migrated"],
  ["mattermost", "phase 2: not yet migrated"],
  ["mautic", "phase 2: not yet migrated"],
  ["medium", "phase 2: not yet migrated"],
  ["messagebird", "phase 3: not yet migrated"],
  ["metabase", "phase 2: not yet migrated"],
  ["misp", "phase 2: not yet migrated"],
  [
    "mocean",
    "body key: mocean-api-key and mocean-api-secret travel in the form body",
  ],
  ["monday", "phase 2: not yet migrated"],
  ["monicaCrm", "phase 2: not yet migrated"],
  ["msg91", "phase 3: not yet migrated"],
  ["nasa", "phase 3: not yet migrated"],
  ["netlify", "phase 2: not yet migrated"],
  ["netscalerAdc", "phase 4: not yet migrated"],
  [
    "nextcloud",
    "WebDAV methods (PROPFIND, MKCOL, COPY, MOVE) the transport does not carry",
  ],
  ["nocodb", "phase 3: not yet migrated"],
  [
    "npm",
    "optional credential: a secret-free config cannot say whether to sign",
  ],
  ["odoo", "login: the password rides in every JSON-RPC argument list"],
  ["okta", "phase 2: not yet migrated"],
  ["oneSimpleApi", "phase 3: not yet migrated"],
  ["onfleet", "phase 3: not yet migrated"],
  ["openai", "phase 3: not yet migrated"],
  ["openweathermap", "phase 3: not yet migrated"],
  ["oura", "phase 2: not yet migrated"],
  ["paddle", "body key: vendor_auth_code travels in the JSON body"],
  ["pagerduty", "phase 3: not yet migrated"],
  ["parallel", "phase 3: not yet migrated"],
  ["paypal", "phase 3: not yet migrated"],
  ["peekalink", "phase 3: not yet migrated"],
  ["phantombuster", "phase 3: not yet migrated"],
  ["philipsHue", "phase 2: not yet migrated"],
  ["pipedrive", "phase 2: not yet migrated"],
  ["plivo", "phase 3: not yet migrated"],
  ["posthog", "body key: api_key travels in the JSON body"],
  ["profitwell", "phase 3: not yet migrated"],
  ["pushbullet", "phase 2: not yet migrated"],
  ["pushcut", "phase 2: not yet migrated"],
  ["pushover", "body key: token travels in the form body"],
  ["quickbase", "phase 2: not yet migrated"],
  ["quickbooks", "phase 2: not yet migrated"],
  ["raindrop", "phase 2: not yet migrated"],
  ["recraft", "phase 3: not yet migrated"],
  [
    "reddit",
    "optional credential: a secret-free config cannot say whether to sign",
  ],
  ["replicate", "phase 3: not yet migrated"],
  ["rocketchat", "phase 2: not yet migrated"],
  ["rundeck", "phase 3: not yet migrated"],
  [
    "salesforce",
    "dynamic host: the API origin comes from the token response's instance_url",
  ],
  ["salesmate", "phase 2: not yet migrated"],
  ["securityScorecard", "phase 3: not yet migrated"],
  ["segment", "phase 3: not yet migrated"],
  ["sendgrid", "phase 3: not yet migrated"],
  ["sendy", "body key: api_key travels in the form body"],
  ["sentry", "phase 2: not yet migrated"],
  ["servicenow", "phase 2: not yet migrated"],
  ["shiftAtlas", "phase 3: not yet migrated"],
  ["shiftBwm", "phase 3: not yet migrated"],
  ["shiftCrm", "phase 2: not yet migrated"],
  ["shiftObjects", "phase 3: not yet migrated"],
  [
    "shiftOcr",
    "deadline: extraction runs up to 5 minutes, beyond the transport's 120 s ceiling",
  ],
  ["shiftPages", "phase 3: not yet migrated"],
  [
    "shiftTranscription",
    "deadline: transcribe waits on /await for up to 120 s plus response time, past the transport's 120 s ceiling",
  ],
  ["shiftWork", "phase 3: not yet migrated"],
  ["shopify", "phase 3: not yet migrated"],
  ["signl4", "path token: the team secret is the URL path"],
  ["slack", "phase 2: not yet migrated"],
  ["sms77", "phase 3: not yet migrated"],
  ["splunk", "phase 2: not yet migrated"],
  ["spotify", "phase 2: not yet migrated"],
  ["stackby", "phase 2: not yet migrated"],
  [
    "steel",
    "WebSocket: the key rides in a wss:// CDP URL the transport cannot carry",
  ],
  [
    "storyblok",
    "two credentials in one connection: content query token and management header token",
  ],
  [
    "strapi",
    "login: password mode mints a JWT; one plugin cannot sign two ways",
  ],
  ["strava", "phase 2: not yet migrated"],
  ["stripe", "phase 3: not yet migrated"],
  ["supabase", "one secret injected twice: apikey header and bearer"],
  ["syncromsp", "phase 3: not yet migrated"],
  ["tapfiliate", "phase 3: not yet migrated"],
  ["telegram", "path token: the bot token is a URL path segment"],
  ["thehive", "phase 3: not yet migrated"],
  ["thehiveProject", "phase 3: not yet migrated"],
  ["todoist", "phase 2: not yet migrated"],
  ["together", "phase 3: not yet migrated"],
  ["travisci", "phase 2: not yet migrated"],
  ["trello", "two secrets per request: key and token query parameters"],
  ["twake", "phase 3: not yet migrated"],
  ["twilio", "phase 3: not yet migrated"],
  ["twist", "phase 2: not yet migrated"],
  ["twitter", "phase 2: not yet migrated"],
  ["typesafe", "phase 3: not yet migrated"],
  ["unleashedSoftware", "signature: HMAC-SHA256 of each query string"],
  ["uplead", "phase 3: not yet migrated"],
  ["uproc", "phase 3: not yet migrated"],
  ["uptimerobot", "body key: api_key travels in the form body"],
  ["urlscanio", "phase 3: not yet migrated"],
  ["vercel", "phase 2: not yet migrated"],
  ["vero", "body key: auth_token travels in the form body"],
  ["vonage", "body key: api_key and api_secret travel in the form body"],
  ["wekan", "phase 2: not yet migrated"],
  ["wolt", "login: hCaptcha login and a rotating, device-bound refresh grant"],
  ["woocommerce", "phase 3: not yet migrated"],
  ["wordpress", "phase 2: not yet migrated"],
  ["xai", "phase 3: not yet migrated"],
  ["xero", "phase 2: not yet migrated"],
  ["yourls", "phase 3: not yet migrated"],
  ["zammad", "phase 3: not yet migrated"],
  ["zendesk", "phase 2: not yet migrated"],
  ["zoho", "phase 2: not yet migrated"],
  ["zoom", "phase 2: not yet migrated"],
  ["zulip", "phase 3: not yet migrated"],
]);

/**
 * Declaring plugins covered by their own dedicated suites
 * (credential-broker, credential-declaration, plaud-plugin) rather than a
 * fixture. May shrink, never grow.
 */
const DEDICATED_SUITES = new Set([
  "gmail",
  "googleAppsScript",
  "googleCalendar",
  "googleContacts",
  "googleDocs",
  "googleDrive",
  "googleSheets",
  "googleSlides",
  "googleTasks",
  "microsoftCalendar",
  "microsoftFiles",
  "microsoftMail",
  "plaud",
]);

function plugins(): string[] {
  return readdirSync(PLUGINS)
    .filter(
      (entry) =>
        !["_shared", "dist", "node_modules", "icons"].includes(entry) &&
        statSync(join(PLUGINS, entry)).isDirectory(),
    )
    .sort();
}

/** `rl.setCredential(` anywhere in the plugin's own sources. */
function declares(plugin: string): boolean {
  const src = join(PLUGINS, plugin, "src");
  return readdirSync(src)
    .filter((name) => name.endsWith(".ts"))
    .some((name) =>
      /\bsetCredential\s*\(/.test(readFileSync(join(src, name), "utf-8")),
    );
}

function fixtures(): string[] {
  return readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".ts") && name !== "fixture.ts")
    .map((name) => name.slice(0, -3))
    .sort();
}

describe("every credential-bearing plugin declares its credential or says why not", () => {
  it("places every plugin in exactly one of: declaring, backlog, no credential", () => {
    const unplaced: string[] = [];
    const doubled: string[] = [];
    for (const plugin of plugins()) {
      const places = [
        declares(plugin),
        UNDECLARED_BACKLOG.has(plugin),
        NO_CREDENTIAL.has(plugin),
      ].filter(Boolean).length;
      if (places === 0) unplaced.push(plugin);
      if (places > 1) doubled.push(plugin);
    }
    assert.deepEqual(
      unplaced,
      [],
      "declare these plugins' credentials (rl.setCredential); a new plugin cannot join the backlog",
    );
    assert.deepEqual(
      doubled,
      [],
      "these plugins declare their credential; delete their lines from UNDECLARED_BACKLOG",
    );
  });

  it("lists only plugins that exist", () => {
    const all = new Set(plugins());
    const gone = [
      ...UNDECLARED_BACKLOG.keys(),
      ...NO_CREDENTIAL.keys(),
      ...DEDICATED_SUITES,
    ].filter((plugin) => !all.has(plugin));
    assert.deepEqual(gone, []);
  });

  it("gives every listed plugin a reason", () => {
    for (const [plugin, reason] of [...UNDECLARED_BACKLOG, ...NO_CREDENTIAL])
      assert.ok(reason.trim().length > 10, `${plugin} needs a specific reason`);
  });

  it("has a fixture for every declaring plugin, and no fixture for anything else", () => {
    const declaring = plugins().filter(declares);
    const covered = new Set([...fixtures(), ...DEDICATED_SUITES]);
    assert.deepEqual(
      declaring.filter((plugin) => !covered.has(plugin)),
      [],
      "add credential-fixtures/<plugin>.ts for these declaring plugins",
    );
    const declared = new Set(declaring);
    assert.deepEqual(
      [...covered].filter((plugin) => !declared.has(plugin)),
      [],
      "these fixtures or suites name plugins that declare no credential",
    );
  });

  it("still has a backlog, so a broken detector cannot look like finished work", () => {
    assert.ok(
      UNDECLARED_BACKLOG.size > 0,
      "an empty backlog means every plugin is migrated: delete this guard with the last entry",
    );
  });
});
