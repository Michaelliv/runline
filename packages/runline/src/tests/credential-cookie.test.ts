/**
 * Cookie-session credentials (SHFT-2630): the kit logs in with the
 * resource owner, keeps every cookie the app's targets set in a jar in
 * the connection, signs requests with it, and logs in again when a
 * response shows the session was rejected — by status, by a redirect to a
 * login path, or by a body marker. The plugin never sees the password, a
 * cookie value or a Set-Cookie.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "../auth/errors.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { brokerFor } from "../credentials/broker.js";
import {
  applySetCookies,
  cookieHeader,
  parseSetCookie,
} from "../credentials/cookies.js";
import { cookieSessionSchema } from "../credentials/plugin.js";
import { CredentialRegistry } from "../credentials/registry.js";
import { CredentialTransport } from "../credentials/transport.js";
import type {
  CookieSession,
  CredentialAuthentication,
  CredentialBinding,
  CredentialDeclaration,
  CredentialType,
} from "../credentials/types.js";
import type { ActionContext } from "../plugin/types.js";

type CookieAuth = Extract<CredentialAuthentication, { kind: "cookie" }>;

const PASSWORD = "hunter2-very-secret";
const OWNER = { username: "dana@example.com", password: PASSWORD };

function cookieType(
  auth: Partial<CookieAuth> = {},
  targets?: CredentialType["methods"][string]["targets"],
): CredentialType {
  return {
    id: "app",
    methods: {
      session: {
        schema: cookieSessionSchema,
        authentication: {
          kind: "cookie",
          field: "session",
          login: {
            target: "app",
            path: "login",
            encoding: "form",
            fields: { username: "email" },
            parameters: { remember: "1" },
            preflight: "login",
          },
          rejection: {
            statuses: [401],
            loginPaths: ["login"],
            marker: 'id="login-form"',
          },
          csrf: { cookie: "csrftoken", header: "X-CSRFToken" },
          ...auth,
        },
        targets: targets ?? {
          app: {
            baseUrl: "https://app.example/",
            methods: ["GET", "HEAD", "POST", "PUT"],
            idempotency: { header: "Idempotency-Key", methods: ["PUT"] },
          },
          other: { baseUrl: "https://other.example/api/", methods: ["GET"] },
        },
      },
    },
  };
}

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/**
 * A fake cookie-session app on app.example: a preflight sets a CSRF
 * cookie, the login checks it and the password and sets a session, and
 * /items answers a live session, else rejects it as `mode` says. `expire`
 * ends every session; `refuse` makes it honour none it issues from then on.
 */
function fakeApp(
  options: {
    mode?: "status" | "redirect" | "marker";
    rotate?: boolean;
    extraSetCookie?: string[];
    loginStatus?: number;
  } = {},
) {
  const sessions = new Set<string>();
  const seen: Seen[] = [];
  let honours = true;
  let logins = 0;
  let rotation = 0;
  const html = (body: string, status = 200, headers: [string, string][] = []) =>
    new Response(body, {
      status,
      headers: [["content-type", "text/html; charset=utf-8"], ...headers],
    });
  const cookiesOf = (headers: Headers) =>
    Object.fromEntries(
      (headers.get("cookie") ?? "")
        .split("; ")
        .filter(Boolean)
        .map((pair) => pair.split("=") as [string, string]),
    );
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const body = init?.body ? Buffer.from(init.body as Buffer).toString() : "";
    const method = init?.method ?? "GET";
    seen.push({ url: url.toString(), method, headers, body });
    const jar = cookiesOf(headers);
    if (url.host !== "app.example") return Response.json({ other: true });
    if (url.pathname === "/login" && method === "GET")
      return html('<form id="login-form"></form>', 200, [
        ["set-cookie", "csrftoken=c1; Path=/"],
      ]);
    if (url.pathname === "/login" && method === "POST") {
      logins++;
      if (options.loginStatus)
        return new Response("nope", { status: options.loginStatus });
      const form = new URLSearchParams(body);
      if (
        jar.csrftoken !== "c1" ||
        headers.get("x-csrftoken") !== "c1" ||
        form.get("email") !== OWNER.username ||
        form.get("password") !== PASSWORD ||
        form.get("remember") !== "1"
      )
        return html('<p>wrong password for dana</p><form id="login-form">');
      const id = `s${logins}`;
      sessions.add(id);
      return new Response(null, {
        status: 302,
        headers: [
          ["location", "/dashboard"],
          ["set-cookie", `sessionid=${id}; Path=/; HttpOnly; Secure`],
        ],
      });
    }
    if (!honours || !sessions.has(jar.sessionid)) {
      if (options.mode === "redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "https://app.example/login?next=/items" },
        });
      if (options.mode === "marker")
        return html('<html><form id="login-form" action="/login"></form>');
      return Response.json({ error: "session expired" }, { status: 401 });
    }
    if (url.pathname === "/elsewhere")
      return new Response(null, {
        status: 302,
        headers: { location: "https://app.example/dashboard" },
      });
    const set: [string, string][] = (options.extraSetCookie ?? []).map(
      (value) => ["set-cookie", value],
    );
    if (options.rotate) set.push(["set-cookie", `rot=${++rotation}; Path=/`]);
    return new Response(JSON.stringify({ ok: true, path: url.pathname }), {
      headers: [["content-type", "application/json"], ...set],
    });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    seen,
    logins: () => logins,
    expire: () => sessions.clear(),
    refuse: () => {
      honours = false;
    },
  };
}

async function harness(
  app: ReturnType<typeof fakeApp>,
  def = cookieType(),
  config: Record<string, unknown> = {},
) {
  const registry = new CredentialRegistry();
  registry.register(def);
  const store = new MemoryConnectionProvider([
    { name: "account", plugin: "app", config },
  ]);
  const handle = await store.resolve({ plugin: "app" });
  const binding: CredentialBinding = {
    type: "app",
    method: "session",
    identity: { name: "account", plugin: "app" },
    connection: handle,
    resourceOwner: OWNER,
  };
  return {
    binding,
    transport: new CredentialTransport(registry, { fetch: app.fetch }),
    stored: async () =>
      (await handle.read()).config.session as CookieSession | undefined,
  };
}

const errorCode = (code: string) => (error: unknown) =>
  error instanceof AuthError && error.code === code;

const names = (session: CookieSession | undefined) =>
  Object.fromEntries((session?.cookies ?? []).map((c) => [c.name, c.value]));

describe("cookie-session credentials", () => {
  it("logs in once, keeps the jar, and signs the API with Cookie", async () => {
    const app = fakeApp();
    const h = await harness(app);
    const response = await h.transport.request(h.binding, {
      target: "app",
      path: "items",
    });
    assert.deepEqual(await response.json(), { ok: true, path: "/items" });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(app.logins(), 1);
    const [preflight, login, api] = app.seen;
    assert.equal(preflight.method, "GET");
    assert.equal(preflight.url, "https://app.example/login");
    assert.equal(login.method, "POST");
    assert.equal(login.headers.get("cookie"), "csrftoken=c1");
    assert.equal(
      login.headers.get("content-type"),
      "application/x-www-form-urlencoded",
    );
    assert.equal(api.headers.get("cookie"), "csrftoken=c1; sessionid=s1");
    assert.deepEqual(names(await h.stored()), {
      csrftoken: "c1",
      sessionid: "s1",
    });
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.equal(app.logins(), 1);
  });

  it("sends JSON logins under the app's field names", async () => {
    const seen: string[] = [];
    const def = cookieType({
      login: {
        target: "app",
        path: "api/session",
        encoding: "json",
        fields: { username: "identifier", password: "secret" },
      },
      csrf: undefined,
    });
    const h = await harness(
      {
        ...fakeApp(),
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).endsWith("api/session")) {
            seen.push(Buffer.from(init?.body as Buffer).toString());
            assert.equal(
              new Headers(init?.headers).get("content-type"),
              "application/json",
            );
            return new Response("{}", {
              headers: { "set-cookie": "sid=j1; Path=/" },
            });
          }
          return Response.json({
            cookie: new Headers(init?.headers).get("cookie"),
          });
        }) as typeof fetch,
      },
      def,
    );
    const response = await h.transport.request(h.binding, {
      target: "app",
      path: "items",
    });
    assert.deepEqual(await response.json(), { cookie: "sid=j1" });
    assert.deepEqual(JSON.parse(seen[0]), {
      identifier: OWNER.username,
      secret: PASSWORD,
    });
  });

  it("persists a rotated cookie and drops a deleted one", async () => {
    const app = fakeApp({
      rotate: true,
      extraSetCookie: ["csrftoken=; Max-Age=0; Path=/"],
    });
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.deepEqual(names(await h.stored()), { sessionid: "s1", rot: "1" });
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.equal(app.seen.at(-1)?.headers.get("cookie"), "sessionid=s1; rot=1");
    assert.deepEqual(names(await h.stored()), { sessionid: "s1", rot: "2" });
    const revision = (await h.stored())?.revision;
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.equal(
      (await h.stored())?.revision,
      revision,
      "rotation keeps the login's revision",
    );
  });

  it("never lets a slow response of an old session undo a newer login", async () => {
    const app = fakeApp();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/slow")) {
        await gate;
        return new Response("{}", {
          headers: { "set-cookie": "sessionid=; Max-Age=0; Path=/" },
        });
      }
      return app.fetch(input, init);
    }) as typeof globalThis.fetch;
    const h = await harness({ ...app, fetch });
    await h.transport.request(h.binding, { target: "app", path: "items" });
    const slow = h.transport.request(h.binding, {
      target: "app",
      path: "slow",
    });
    app.expire();
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.equal(names(await h.stored()).sessionid, "s2");
    release();
    await slow;
    assert.equal(names(await h.stored()).sessionid, "s2");
  });

  for (const mode of ["status", "redirect", "marker"] as const) {
    it(`re-logs in once and replays a GET once when the session is rejected by ${mode}`, async () => {
      const app = fakeApp({ mode });
      const h = await harness(app);
      await h.transport.request(h.binding, { target: "app", path: "items" });
      app.expire();
      const before = app.seen.length;
      const response = await h.transport.request(h.binding, {
        target: "app",
        path: "items",
      });
      assert.equal(response.status, 200);
      assert.equal(app.logins(), 2);
      const after = app.seen
        .slice(before)
        .map((s) => `${s.method} ${new URL(s.url).pathname}`);
      assert.deepEqual(after, [
        "GET /items",
        "GET /login",
        "POST /login",
        "GET /items",
      ]);
      assert.equal(
        app.seen.at(-1)?.headers.get("cookie"),
        "csrftoken=c1; sessionid=s2",
      );
    });
  }

  it("answers a rejection that persists after the replay as 401, with no further login", async () => {
    for (const mode of ["redirect", "marker"] as const) {
      const app = fakeApp({ mode });
      const h = await harness(app);
      await h.transport.request(h.binding, { target: "app", path: "items" });
      app.refuse();
      const response = await h.transport.request(h.binding, {
        target: "app",
        path: "items",
      });
      assert.equal(response.status, 401);
      assert.equal(app.logins(), 2);
    }
  });

  it("never replays a rejected write, but logs in again so the next one is signed by a live session", async () => {
    const app = fakeApp({ mode: "redirect" });
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    app.expire();
    const write = {
      target: "app",
      path: "items",
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    };
    const response = await h.transport.request(h.binding, write);
    assert.equal(response.status, 401);
    assert.equal(app.logins(), 2);
    const writes = () =>
      app.seen.filter((s) => s.method === "POST" && s.url.endsWith("items"));
    assert.equal(writes().length, 1);
    assert.equal((await h.transport.request(h.binding, write)).status, 200);
    assert.equal(app.logins(), 2);
    assert.equal(writes().length, 2);
  });

  it("replays an idempotent write once, with its key, after logging in again", async () => {
    const app = fakeApp();
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    app.expire();
    const response = await h.transport.request(h.binding, {
      target: "app",
      path: "items",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      idempotencyKey: "k1",
    });
    assert.equal(response.status, 200);
    const puts = app.seen.filter((s) => s.method === "PUT");
    assert.equal(puts.length, 2);
    assert.ok(puts.every((s) => s.headers.get("idempotency-key") === "k1"));
  });

  it("logs in once for five parallel calls on an expired session, and once with no session", async () => {
    const app = fakeApp();
    const h = await harness(app);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        h.transport.request(h.binding, { target: "app", path: "items" }),
      ),
    );
    assert.equal(app.logins(), 1);
    app.expire();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        h.transport.request(h.binding, { target: "app", path: "items" }),
      ),
    );
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(app.logins(), 2);
  });

  it("sends no cookie to another host and stores none an app sets for a foreign domain", async () => {
    const app = fakeApp({
      extraSetCookie: [
        "evil=1; Domain=evil.example; Path=/",
        "suffix=1; Domain=example; Path=/",
        "wide=1; Domain=app.example; Path=/",
      ],
    });
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    const stored = names(await h.stored());
    assert.equal(stored.evil, undefined);
    assert.equal(stored.suffix, undefined);
    assert.equal(stored.wide, "1");
    await h.transport.request(h.binding, { target: "other", path: "items" });
    assert.equal(app.seen.at(-1)?.url, "https://other.example/api/items");
    assert.equal(app.seen.at(-1)?.headers.get("cookie"), null);
  });

  it("sends the password in the login request alone", async () => {
    const app = fakeApp({ mode: "status" });
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    app.expire();
    await h.transport.request(h.binding, { target: "app", path: "items" });
    const carrying = app.seen.filter(
      (s) =>
        s.url.includes(PASSWORD) ||
        s.body.includes(PASSWORD) ||
        [...s.headers.values()].some((v) => v.includes(PASSWORD)),
    );
    assert.equal(carrying.length, 2);
    assert.ok(
      carrying.every(
        (s) => s.method === "POST" && s.url === "https://app.example/login",
      ),
    );
  });

  it("refuses a login the app answers with a rejection, or by status, without its text or cookies", async () => {
    const wrong = await harness(fakeApp(), cookieType(), {});
    wrong.binding.resourceOwner = {
      username: OWNER.username,
      password: "nope",
    };
    await assert.rejects(
      wrong.transport.request(wrong.binding, { target: "app", path: "items" }),
      (error: unknown) =>
        errorCode("reconnect_required")(error) &&
        !String((error as Error).message).includes("dana") &&
        !String((error as Error).message).includes("c1"),
    );
    for (const status of [401, 503]) {
      const h = await harness(fakeApp({ loginStatus: status }));
      await assert.rejects(
        h.transport.request(h.binding, { target: "app", path: "items" }),
        (error: unknown) =>
          errorCode("provider_rejected")(error) &&
          (error as AuthError).status === status &&
          !(error as Error).message.includes("nope"),
      );
    }
    const none = await harness(fakeApp());
    none.binding.resourceOwner = undefined;
    await assert.rejects(
      none.transport.request(none.binding, { target: "app", path: "items" }),
      errorCode("invalid_credentials"),
    );
  });

  it("copies the CSRF cookie into its header on unsafe methods only, and reserves the header", async () => {
    const app = fakeApp();
    const h = await harness(app);
    await h.transport.request(h.binding, { target: "app", path: "items" });
    assert.equal(app.seen.at(-1)?.headers.get("x-csrftoken"), null);
    await h.transport.request(h.binding, {
      target: "app",
      path: "items",
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(app.seen.at(-1)?.headers.get("x-csrftoken"), "c1");
    await assert.rejects(
      h.transport.request(h.binding, {
        target: "app",
        path: "items",
        headers: { "X-CSRFToken": "forged" },
      }),
      errorCode("request_not_allowed"),
    );
  });

  it("refuses a redirect that is not to a login path, as every transport redirect is", async () => {
    const app = fakeApp();
    const h = await harness(app);
    await assert.rejects(
      h.transport.request(h.binding, { target: "app", path: "elsewhere" }),
      errorCode("transport_failed"),
    );
  });

  it("reports a rejected session as rejected through the probe", async () => {
    const app = fakeApp({ mode: "redirect" });
    const def = cookieType();
    def.methods.session.probe = {
      target: "app",
      path: "items",
      method: "GET",
      acceptedStatuses: [200],
    };
    const h = await harness(app, def);
    assert.equal((await h.transport.probe(h.binding)).outcome, "accepted");
    app.refuse();
    assert.equal((await h.transport.probe(h.binding)).outcome, "rejected");
  });
});

describe("cookie method registration", () => {
  const register = (def: CredentialType) =>
    new CredentialRegistry().register(def);

  it("accepts a declared login and rejection", () => {
    register(cookieType());
    register(cookieType({ csrf: undefined, rejection: { statuses: [419] } }));
  });

  it("refuses logins, rejections and CSRF headers it cannot enforce", () => {
    const bad: Array<Partial<CookieAuth>> = [
      { rejection: {} },
      { rejection: { statuses: [] } },
      { rejection: { statuses: [302] } },
      { rejection: { loginPaths: [] } },
      { rejection: { loginPaths: ["../login"] } },
      { rejection: { marker: "" } },
      { rejection: { marker: "x".repeat(129) } },
      { csrf: { cookie: "csrftoken", header: "Cookie" } },
      { csrf: { cookie: "csrftoken", header: "Authorization" } },
      { csrf: { cookie: "bad name", header: "X-CSRF" } },
      { login: { target: "missing", path: "login", encoding: "form" } },
      { login: { target: "other", path: "login", encoding: "form" } },
      { login: { target: "app", path: "/login", encoding: "form" } },
      { login: { target: "app", path: "login", encoding: "xml" as "form" } },
      {
        login: {
          target: "app",
          path: "login",
          encoding: "form",
          fields: { username: "user", password: "user" },
        },
      },
      {
        login: {
          target: "app",
          path: "login",
          encoding: "form",
          parameters: { password: "x" },
        },
      },
      {
        login: {
          target: "app",
          path: "login",
          encoding: "form",
          fields: { username: "a b" },
        },
      },
    ];
    for (const auth of bad)
      assert.throws(
        () => register(cookieType(auth)),
        errorCode("invalid_definition"),
        JSON.stringify(auth),
      );
  });

  it("refuses a preflight on a target that cannot GET, a socket target, and a required jar", () => {
    assert.throws(
      () =>
        register(
          cookieType(
            {},
            { app: { baseUrl: "https://app.example/", methods: ["POST"] } },
          ),
        ),
      errorCode("invalid_definition"),
    );
    assert.throws(
      () =>
        register(
          cookieType(
            {},
            {
              app: {
                baseUrl: "https://app.example/",
                methods: ["GET", "POST"],
              },
              ws: {
                baseUrl: "wss://app.example/",
                methods: ["GET"],
                socket: true,
              },
            },
          ),
        ),
      errorCode("invalid_definition"),
    );
    const required = cookieType();
    required.methods.session.schema = {
      ...cookieSessionSchema,
      required: ["session"],
    } as unknown as typeof cookieSessionSchema;
    assert.throws(() => register(required), errorCode("invalid_definition"));
  });
});

describe("the cookie jar", () => {
  const url = new URL("https://app.example/account/settings");
  const now = 1_000_000;

  it("defaults the path to the request's directory and matches paths on segment boundaries", () => {
    const jar = applySetCookies(
      [],
      ["a=1", "b=2; Path=/acc", "c=3; Path=/"],
      url,
      now,
    );
    assert.equal(jar.find((c) => c.name === "a")?.path, "/account");
    assert.equal(
      cookieHeader(jar, new URL("https://app.example/account/x"), now),
      "a=1; c=3",
    );
    assert.equal(
      cookieHeader(jar, new URL("https://app.example/acc/x"), now),
      "b=2; c=3",
    );
  });

  it("keeps host-only cookies to their host and domain cookies to its subdomains", () => {
    const jar = applySetCookies(
      [],
      ["host=1; Path=/", "dom=2; Domain=.app.example; Path=/"],
      url,
      now,
    );
    assert.equal(
      cookieHeader(jar, new URL("https://api.app.example/"), now),
      "dom=2",
    );
    assert.equal(
      cookieHeader(jar, new URL("https://notapp.example/"), now),
      undefined,
    );
  });

  it("honours Max-Age over Expires, and drops expired cookies", () => {
    const later = new Date(now + 3_600_000).toUTCString();
    const jar = applySetCookies(
      [],
      [`a=1; Expires=${later}; Max-Age=10`, `b=2; Expires=${later}`],
      url,
      now,
    );
    assert.equal(jar.find((c) => c.name === "a")?.expiresAt, now + 10_000);
    assert.equal(cookieHeader(jar, url, now + 20_000), "b=2");
    assert.deepEqual(applySetCookies(jar, [], url, now + 7_200_000), []);
  });

  it("ignores cookies it could not send back", () => {
    for (const header of [
      "novalue",
      "=x",
      "a=b\u0001",
      "bad name=1",
      `big=${"x".repeat(5000)}`,
    ])
      assert.equal(parseSetCookie(header, url, now), undefined, header);
  });
});

describe("the local signer keeps a cookie jar in flat config", () => {
  const declaration: CredentialDeclaration = (config) => ({
    type: cookieType(),
    method: "session",
    resourceOwner: {
      username: String(config.email ?? ""),
      password: String(config.password ?? ""),
    },
  });

  function local(config: Record<string, unknown>): ActionContext & {
    stored: () => Record<string, unknown>;
  } {
    let current = structuredClone(config);
    return {
      connection: {
        name: "account",
        plugin: "app",
        get config() {
          return current;
        },
      },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection(change) {
        const patch =
          typeof change === "function"
            ? await change(structuredClone(current))
            : change;
        if (patch) current = { ...current, ...patch };
      },
      stored: () => current,
    };
  }

  it("round-trips the jar, and a changed selection never reuses it", async () => {
    const app = fakeApp({ rotate: true });
    const original = globalThis.fetch;
    globalThis.fetch = app.fetch;
    try {
      const ctx = local({ email: OWNER.username, password: PASSWORD });
      await brokerFor(ctx, declaration).request({
        target: "app",
        path: "items",
      });
      await brokerFor(ctx, declaration).request({
        target: "app",
        path: "items",
      });
      assert.equal(app.logins(), 1);
      const flat = ctx.stored().cookieSession as CookieSession & {
        binding: string;
      };
      assert.equal(typeof flat.binding, "string");
      assert.deepEqual(names(flat), {
        csrftoken: "c1",
        sessionid: "s1",
        rot: "2",
      });
      assert.equal(ctx.stored().session, undefined);

      ctx.connection.config.email = "someone@example.com";
      await assert.rejects(
        brokerFor(ctx, declaration).request({ target: "app", path: "items" }),
        errorCode("reconnect_required"),
      );
      assert.equal(app.logins(), 2);
      const posted = new URLSearchParams(app.seen.at(-1)?.body);
      assert.equal(posted.get("email"), "someone@example.com");
      assert.equal(
        app.seen.at(-1)?.headers.get("cookie"),
        "csrftoken=c1",
        "the old jar is not sent under the new selection",
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
