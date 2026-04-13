# runline ⚡

Code mode for agents.

Turn any API into a callable action. Install a plugin, write JavaScript, call actions. The code runs in a QuickJS WASM sandbox — no filesystem, no network, just plugin actions via a proxy.

```bash
npm install -g runline
```

## Quick Start

```bash
runline init
runline plugin install git:github.com/Michaelliv/runline#plugins/brandfetch
runline connection add bf --plugin brandfetch --set apiKey=xxx

runline exec 'return await actions.brandfetch["brand.getColors"]({ domain: "nike.com" })'
# => [{ hex: "#E5E5E5", type: "accent" }, { hex: "#111111", type: "dark" }, ...]
```

Agent code runs in a QuickJS sandbox with an `actions` proxy. Plugins execute outside the sandbox with full network access — the agent can only reach APIs through the actions you've installed.

```js
// agent writes this
const company = await actions.brandfetch["brand.getCompany"]({ domain: "stripe.com" });
const deals = await actions.pipedrive["deal.list"]({ limit: 10 });
const issue = await actions.github["issue.create"]({
  owner: "acme", repo: "api",
  title: `New lead: ${company.name}`,
  body: `${deals.length} open deals`
});
return { company: company.name, issue: issue.number };
```

## Plugins

188 plugins covering popular SaaS, DevOps, and productivity APIs. Each wraps a single service's REST/GraphQL API with typed actions.

All plugins install via `runline plugin install git:github.com/Michaelliv/runline#plugins/<name>`.

| Plugin | Actions | Auth |
|--------|---------|------|
| **github** | file/issue/pr/release/repo/review/user CRUD, search | Bearer token |
| **gitlab** | issue/merge request/repo/user CRUD | Bearer token |
| **jira** | issue/project/user CRUD, transitions | Basic auth |
| **slack** | channel/message/user/reaction/star/file ops | Bearer token |
| **discord** | channel/message/member CRUD, reactions | Bot token |
| **notion** | block/database/page/user CRUD, search | Bearer token |
| **todoist** | task/project/section/comment/label CRUD | Bearer token |
| **linear** | issue/project/team/comment CRUD (GraphQL) | Bearer token |
| **hubspot** | contact/company/deal/ticket/engagement CRUD | Bearer token |
| **pipedrive** | deal/person/org/activity/lead/note/product CRUD, search | API token |
| **salesforce** | account/contact/lead/opportunity/case/task CRUD | OAuth2 |
| **shopify** | order/product/customer CRUD | API key |
| **stripe** | charge/customer/source/coupon CRUD | Bearer token |
| **airtable** | base/record CRUD, search, upsert | Bearer token |
| **supabase** | row CRUD | API key |
| **docker** | container/image/volume/network ops | Unix socket |
| **telegram** | message/chat/callback/pin ops | Bot token in URL |
| **twitter** | tweet/user/dm/list ops | OAuth2 Bearer |
| **clickup** | task/list/folder/space/comment/checklist/team CRUD | Bearer token |
| **asana** | task/project/section/subtask/tag/user CRUD | Bearer token |
| **trello** | board/list/card/checklist/attachment/label/member CRUD | API key |
| **monday** | board/group/item/column/update (GraphQL) | Bearer token |
| **mailchimp** | list/member/campaign/tag ops | Bearer token |
| **sendgrid** | contact/list/email ops | Bearer token |
| **elasticsearch** | document/index CRUD | Basic auth |
| **cloudflare** | zone/dns/worker/kv/r2/d1/pages/queue CRUD | Bearer token |
| **databricks** | sql/files/genie/catalog/table/volume/function/vector search | Bearer token |
| **splunk** | search/alert/report/user CRUD | Bearer token |
| **home-assistant** | state/service/history/config/template/event ops | Bearer token |
| **openweathermap** | current/5-day forecast | API key |
| **brandfetch** | logos/colors/fonts/company/industry lookup | Bearer token |

<details>
<summary>All 188 plugins</summary>

action-network, active-campaign, adalo, affinity, agile-crm, airtable, airtop, api-template-io, asana, autopilot, bamboo-hr, bannerbear, baserow, beeminder, bitly, bitwarden, box, brandfetch, brevo, bubble, chargebee, circleci, cisco-webex, clearbit, clickup, clockify, cloudflare, cockpit, coda, coingecko, contentful, convertkit, copper, cortex, currents, customer-io, databricks, deepl, demio, dhl, discord, discourse, disqus, docker, drift, dropbox, dropcontact, egoi, elasticsearch, emelia, erpnext, facebook-graph, freshdesk, freshservice, freshworks-crm, getresponse, ghost, github, gitlab, gong, gotify, gotowebinar, grafana, graphql, grist, hackernews, halopsa, harvest, helpscout, highlevel, home-assistant, hubspot, humantic-ai, hunter, intercom, iterable, jenkins, jira, keap, kobotoolbox, lemlist, line, linear, lingvanex, linkedin, lonescale, magento, mailcheck, mailchimp, mailerlite, mailgun, mailjet, mandrill, marketstack, matrix, mattermost, mautic, medium, messagebird, metabase, misp, mocean, monday, monica-crm, msg91, nasa, netlify, netscaler-adc, nextcloud, nocodb, notion, npm, odoo, okta, one-simple-api, onfleet, open-thesaurus, openweathermap, oura, paddle, pagerduty, paypal, peekalink, phantombuster, philips-hue, pipedrive, plivo, postbin, posthog, profitwell, pushbullet, pushcut, pushover, quickbase, quickbooks, quickchart, raindrop, reddit, rocketchat, rundeck, salesforce, salesmate, security-scorecard, segment, sendgrid, sendy, sentry, servicenow, shopify, signl4, slack, sms77, splunk, spotify, stackby, storyblok, strapi, strava, stripe, supabase, syncromsp, tapfiliate, telegram, thehive, thehive-project, todoist, travisci, trello, twake, twilio, twist, twitter, unleashed-software, uplead, uproc, uptimerobot, urlscanio, vero, vonage, wekan, woocommerce, wordpress, xero, yourls, zammad, zendesk, zoho, zoom, zulip

</details>

## Examples

```bash
# List all available actions
runline actions

# Get Nike's brand colors
runline exec 'return await actions.brandfetch["brand.getColors"]({ domain: "nike.com" })'

# Create a GitHub issue
runline exec '
  return await actions.github["issue.create"]({
    owner: "acme", repo: "api",
    title: "Bug: login broken",
    labels: ["bug", "urgent"]
  })
'

# Search Pipedrive deals
runline exec 'return await actions.pipedrive["deal.search"]({ term: "Acme" })'

# Chain actions together
runline exec '
  const contact = await actions.hubspot["contact.get"]({ id: "123" });
  const task = await actions.todoist["task.create"]({
    content: `Follow up with ${contact.properties.firstname}`,
    priority: 4
  });
  return { contact: contact.properties.email, taskId: task.id };
'

# Output as JSON (for agents)
runline exec 'return await actions.github["repo.list"]({ owner: "torvalds" })' --json
```

## Writing a Plugin

Plugins export a function that receives a `RunlinePluginAPI` and registers actions.

```typescript
import type { RunlinePluginAPI } from "runline";

export default function orders(rl: RunlinePluginAPI) {
  rl.setName("orders");
  rl.setVersion("1.0.0");

  // Connection config — env vars override config.json values
  rl.setConnectionSchema({
    apiKey: { type: "string", required: true, env: "ORDERS_API_KEY" },
    baseUrl: { type: "string", required: true, env: "ORDERS_BASE_URL" },
  });

  rl.registerAction("list", {
    description: "List orders for an organization",
    inputSchema: {
      orgId: { type: "string", required: true },
      status: { type: "string", required: false, description: "open, closed, or all" },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { orgId, status, limit } = input as Record<string, unknown>;
      const url = new URL(`${ctx.connection.config.baseUrl}/orgs/${orgId}/orders`);
      if (status) url.searchParams.set("status", status as string);
      if (limit) url.searchParams.set("limit", String(limit));

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${ctx.connection.config.apiKey}` },
      });
      if (!res.ok) throw new Error(`Orders API ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });

  rl.registerAction("create", {
    description: "Create a new order",
    inputSchema: {
      orgId: { type: "string", required: true },
      customer: { type: "string", required: true },
      total: { type: "number", required: true },
    },
    async execute(input, ctx) {
      const res = await fetch(`${ctx.connection.config.baseUrl}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.connection.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Orders API ${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
}
```

Key points: `execute` runs **outside** the sandbox with full Node.js access (fetch, fs, etc). The sandbox can only call your actions through the proxy. `ctx.connection.config` holds the resolved config with env var overrides applied.

See [plugins/](plugins/) for 188 real-world examples.

## Sandbox

Agent code runs in a [QuickJS](https://bellard.org/quickjs/) WASM sandbox:

- **No `fetch`** — network access is only through plugin actions
- **No `fs`** — no filesystem access
- **Timeout** — configurable, kills infinite loops
- **Memory limit** — configurable, prevents OOM
- **`console.log`** — captured and returned in `result.logs`
- **Plugin globals** — each installed plugin is a top-level proxy (e.g. `github`, `slack`, `brandfetch`). Dot-chain into resource and action: `github.issue.create(input)`

## For Agents

Every command supports `--json`. Use `runline actions --json` for full schemas with input types.

```bash
runline actions --json          # all actions with schemas
runline exec '<code>' --json    # structured { result, logs } output
```

## SDK

```typescript
import { Runline } from "runline";
import brandfetch from "runline-plugin-brandfetch";

const rl = Runline.create({
  plugins: [brandfetch],
  connections: [{ name: "bf", plugin: "brandfetch", config: { apiKey: "xxx" } }],
});

const result = await rl.execute(`
  const colors = await brandfetch.brand.getColors({ domain: "stripe.com" });
  return colors.filter(c => c.type === "accent");
`);

console.log(result.result);  // [{ hex: "#635BFF", type: "accent", brightness: 116 }]
```

## CLI Reference

```bash
runline exec "<code>"                  # execute JS in sandbox
runline exec -f ./script.js            # execute a file
runline actions                        # list all actions
runline plugin install <source>        # install from git/npm/local
runline plugin list                    # list installed plugins
runline plugin remove <name>           # remove a plugin
runline connection add <n> -p <plugin> -s key=val  # add connection
runline connection list                # list connections
runline connection remove <name>       # remove a connection
runline init                           # create .runline/ directory
```

## Configuration

`.runline/config.json`:

```json
{
  "connections": [
    { "name": "gh", "plugin": "github", "config": { "token": "ghp_xxx" } },
    { "name": "bf", "plugin": "brandfetch", "config": { "apiKey": "xxx" } }
  ],
  "timeoutMs": 30000,
  "memoryLimitBytes": 67108864
}
```

Env vars override config values. Plugins declare env var names in their connection schema (e.g. `GITHUB_TOKEN`).

## Development

```bash
npm install
npm run dev -- exec 'return 1 + 2'
npm test
npm run check
```

## How It Relates to dripline

[dripline](https://github.com/Michaelliv/dripline) is **query mode** — SQL tables over live APIs. runline is **code mode** — JavaScript actions over the same APIs. Same plugin architecture, same connection config, different interface. Use dripline when you want to `SELECT` rows; use runline when you want to `create`, `update`, `delete`, or chain multiple API calls together.

## License

MIT
