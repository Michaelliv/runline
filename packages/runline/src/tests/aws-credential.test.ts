/**
 * AWS SigV4 credentials: a method's targets name what they are signed
 * for; the transport signs with the stored access key, or with role
 * sessions it assumes through STS, renews before they expire and issues
 * once however many requests find one stale. The signature itself is
 * pinned to AWS's published suite in sigv4.test.ts; here each request is
 * checked against the signer over exactly the bytes that went out.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as t from "typebox";
import { AuthError } from "../auth/errors.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import {
  awsCredential,
  awsJson,
  awsList,
  awsQuery,
  awsTarget,
} from "../credentials/aws-plugin.js";
import { brokerFor } from "../credentials/broker.js";
import {
  AwsAccessKeySchema,
  AwsSessionSchema,
  CredentialRegistry,
  OAuthGrantSchema,
} from "../credentials/registry.js";
import { signSigV4 } from "../credentials/sigv4.js";
import { CredentialTransport } from "../credentials/transport.js";
import type {
  AwsAccessKey,
  AwsRole,
  CredentialBinding,
  CredentialMethod,
  CredentialType,
} from "../credentials/types.js";
import type { ActionContext } from "../plugin/types.js";

const KEY = { accessKeyId: "AKIDBASE", secretAccessKey: "base-secret" };
const ROLE: AwsRole = {
  roleArn: "arn:aws:iam::123456789012:role/fleet-readonly",
  sessionName: "vex-fleet-ops",
  externalId: "ext-1",
  durationSeconds: 3600,
  region: "us-east-1",
};
const SSM = "https://ssm.us-east-1.amazonaws.com/";
const STS = "https://sts.us-east-1.amazonaws.com/";

const errorCode = (code: string) => (error: unknown) =>
  error instanceof AuthError && error.code === code;

function sigV4Method(assumeRole = false): CredentialMethod {
  return {
    schema: t.Object(
      {
        credential: AwsAccessKeySchema,
        ...(assumeRole ? { session: t.Optional(AwsSessionSchema) } : {}),
      },
      { additionalProperties: false },
    ),
    authentication: {
      kind: "awsSigV4",
      field: "credential",
      ...(assumeRole ? { assumeRole: { sessionField: "session" } } : {}),
    },
    targets: { ssm: awsTarget("ssm", "us-east-1") },
  };
}

function type(method: CredentialMethod): CredentialType {
  return { id: "aws", methods: { selected: method } };
}

interface Sent {
  url: string;
  method: string;
  headers: Headers;
  body: Buffer;
}

/** Records every request; STS answers with a session, everything else 200. */
function aws(
  options: {
    sts?: (sent: Sent) => Response;
    api?: (sent: Sent) => Response;
  } = {},
) {
  const sts: Sent[] = [];
  const api: Sent[] = [];
  let issued = 0;
  const fetch = (async (url: string, init: RequestInit = {}) => {
    const sent: Sent = {
      url: String(url),
      method: String(init.method),
      headers: new Headers(init.headers),
      body: Buffer.from((init.body as Uint8Array | undefined) ?? []),
    };
    if (sent.url === STS) {
      sts.push(sent);
      if (options.sts) return options.sts(sent);
      issued += 1;
      return new Response(
        `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>ASIASESSION${issued}</AccessKeyId>
      <SecretAccessKey>session-secret-${issued}</SecretAccessKey>
      <SessionToken>session-token-${issued}</SessionToken>
      <Expiration>${new Date(Date.now() + 3_600_000).toISOString()}</Expiration>
    </Credentials>
  </AssumeRoleResult>
</AssumeRoleResponse>`,
        { status: 200, headers: { "content-type": "text/xml" } },
      );
    }
    api.push(sent);
    return options.api ? options.api(sent) : Response.json({ ok: true });
  }) as typeof globalThis.fetch;
  return { fetch, sts, api };
}

async function harness(
  fetch: typeof globalThis.fetch,
  config: Record<string, unknown>,
  method = sigV4Method(),
  awsRole?: AwsRole,
) {
  const registry = new CredentialRegistry();
  registry.register(type(method));
  const store = new MemoryConnectionProvider([
    { name: "account", plugin: "aws", config },
  ]);
  const connection = await store.resolve({ plugin: "aws" });
  const binding: CredentialBinding = {
    type: "aws",
    method: "selected",
    identity: { name: "account", plugin: "aws" },
    connection,
    ...(awsRole ? { awsRole } : {}),
  };
  return {
    connection,
    binding,
    transport: new CredentialTransport(registry, { fetch }),
  };
}

/** Whether `sent` carries the signature SigV4 gives exactly its bytes. */
function signedBy(sent: Sent, key: AwsAccessKey, service: string): boolean {
  const url = new URL(sent.url);
  const at = sent.headers.get("x-amz-date") ?? "";
  const added = new Set([
    "authorization",
    "x-amz-date",
    "x-amz-security-token",
    "x-amz-content-sha256",
  ]);
  const expected = signSigV4(
    {
      method: sent.method,
      host: url.host,
      path: url.pathname,
      query: url.searchParams,
      headers: [...sent.headers].filter(([name]) => !added.has(name)),
      body: sent.body,
    },
    key,
    { service, region: "us-east-1" },
    new Date(
      `${at.slice(0, 4)}-${at.slice(4, 6)}-${at.slice(6, 8)}T${at.slice(9, 11)}:${at.slice(11, 13)}:${at.slice(13, 15)}Z`,
    ),
  );
  return sent.headers.get("authorization") === expected.authorization;
}

describe("a SigV4 method declares what each target is signed for", () => {
  it("registers when every target names its service and region", () => {
    new CredentialRegistry().register(type(sigV4Method()));
    new CredentialRegistry().register(type(sigV4Method(true)));
  });

  it("refuses a target without a signing scope, with a malformed one, or a socket", () => {
    for (const aws of [
      undefined,
      { service: "SSM", region: "us-east-1" },
      { service: "ssm", region: "useast1" },
    ]) {
      const method = sigV4Method();
      method.targets.ssm = { ...method.targets.ssm, aws } as never;
      assert.throws(
        () => new CredentialRegistry().register(type(method)),
        errorCode("invalid_definition"),
      );
    }
    const socket = sigV4Method();
    socket.targets.ssm = {
      baseUrl: "wss://ssm.us-east-1.amazonaws.com/",
      methods: ["GET"],
      socket: true,
      aws: { service: "ssm", region: "us-east-1" },
    };
    assert.throws(
      () => new CredentialRegistry().register(type(socket)),
      errorCode("invalid_definition"),
    );
  });

  it("refuses a signing scope on any other method's target", () => {
    const oauth: CredentialMethod = {
      schema: t.Object(
        { grant: t.Optional(OAuthGrantSchema) },
        { additionalProperties: false },
      ),
      authentication: {
        kind: "oauth2",
        field: "grant",
        renewal: "refresh",
        definition: {
          id: "x",
          provider: "x",
          refresh: {
            url: "https://auth.example/token",
            clientAuthentication: "none",
          },
        },
      },
      targets: { api: awsTarget("ssm", "us-east-1") },
    };
    assert.throws(
      () => new CredentialRegistry().register(type(oauth)),
      errorCode("invalid_definition"),
    );
  });

  it("stores exactly an access key, and a session only in an optional field of its own", () => {
    const shapes: CredentialMethod[] = [];
    const wrongKey = sigV4Method();
    wrongKey.schema = t.Object(
      { credential: t.Object({ accessKeyId: t.String() }) },
      { additionalProperties: false },
    );
    shapes.push(wrongKey);
    const sameField = sigV4Method(true);
    sameField.authentication = {
      kind: "awsSigV4",
      field: "credential",
      assumeRole: { sessionField: "credential" },
    };
    shapes.push(sameField);
    const requiredSession = sigV4Method(true);
    requiredSession.schema = t.Object(
      { credential: AwsAccessKeySchema, session: AwsSessionSchema },
      { additionalProperties: false },
    );
    shapes.push(requiredSession);
    for (const method of shapes)
      assert.throws(
        () => new CredentialRegistry().register(type(method)),
        errorCode("invalid_definition"),
      );
  });
});

describe("the transport signs with the stored access key", () => {
  it("signs every byte it sends, and adds a session's token", async () => {
    const keys: AwsAccessKey[] = [KEY, { ...KEY, sessionToken: "tok" }];
    for (const key of keys) {
      const calls = aws();
      const h = await harness(calls.fetch, { credential: key });
      const response = await h.transport.request(h.binding, {
        target: "ssm",
        path: "",
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "AmazonSSM.DescribeInstanceInformation",
        },
        body: "{}",
      });
      assert.equal(response.status, 200);
      const [sent] = calls.api;
      assert.equal(sent.url, SSM);
      assert.ok(signedBy(sent, key, "ssm"));
      assert.match(
        sent.headers.get("authorization") ?? "",
        /^AWS4-HMAC-SHA256 Credential=AKIDBASE\/\d{8}\/us-east-1\/ssm\/aws4_request, SignedHeaders=content-type;host;x-amz-date;(x-amz-security-token;)?x-amz-target, /,
      );
      assert.equal(
        sent.headers.get("x-amz-security-token"),
        key.sessionToken ?? null,
      );
    }
  });

  it("sends the query in the canonical encoding it signed", async () => {
    const calls = aws();
    const method = sigV4Method();
    method.targets.ssm = awsTarget("ssm", "us-east-1", { methods: ["GET"] });
    const h = await harness(calls.fetch, { credential: KEY }, method);
    await h.transport.request(h.binding, {
      target: "ssm",
      path: "?b=2&a=x+y&c=%E1%88%B4",
    });
    const [sent] = calls.api;
    assert.equal(sent.url, `${SSM}?a=x%20y&b=2&c=%E1%88%B4`);
    assert.ok(signedBy(sent, KEY, "ssm"));
  });

  it("refuses a caller's SigV4 headers and presigned-URL parameters before any IO", async () => {
    const calls = aws();
    const h = await harness(calls.fetch, { credential: KEY });
    for (const header of [
      "X-Amz-Date",
      "X-Amz-Security-Token",
      "X-Amz-Content-Sha256",
      "Authorization",
    ])
      await assert.rejects(
        h.transport.request(h.binding, {
          target: "ssm",
          path: "",
          method: "POST",
          headers: { [header]: "x" },
        }),
        errorCode("request_not_allowed"),
      );
    for (const param of ["X-Amz-Signature", "x-amz-credential"])
      await assert.rejects(
        h.transport.request(h.binding, { target: "ssm", path: `?${param}=x` }),
        errorCode("request_not_allowed"),
      );
    assert.equal(calls.api.length, 0);
  });

  it("refuses a stored key that is not an access key, or would not survive a header, before any IO", async () => {
    const calls = aws();
    for (const credential of [
      { accessKeyId: "AKID" },
      "AKID:secret",
      { ...KEY, accessKeyId: "AKID\r\nX-Injected: 1" },
      { ...KEY, accessKeyId: "AKID BASE" },
      { ...KEY, sessionToken: "tok\nen" },
    ]) {
      for (const [method, role] of [
        [sigV4Method(), undefined],
        [sigV4Method(true), ROLE],
      ] as const) {
        const h = await harness(calls.fetch, { credential }, method, role);
        await assert.rejects(
          h.transport.request(h.binding, { target: "ssm", path: "" }),
          (error: unknown) =>
            errorCode("invalid_credentials")(error) &&
            !String(error).includes("Injected"),
        );
      }
    }
    assert.equal(calls.api.length + calls.sts.length, 0);
  });
});

describe("the transport signs with sessions of an assumed role", () => {
  it("assumes the role with the stored key, then signs with the session and keeps it", async () => {
    const calls = aws();
    const h = await harness(
      calls.fetch,
      { credential: KEY },
      sigV4Method(true),
      ROLE,
    );
    for (let i = 0; i < 2; i++)
      await h.transport.request(h.binding, { target: "ssm", path: "" });

    assert.equal(calls.sts.length, 1);
    const [assume] = calls.sts;
    assert.ok(signedBy(assume, KEY, "sts"));
    assert.deepEqual(
      Object.fromEntries(new URLSearchParams(assume.body.toString())),
      {
        Action: "AssumeRole",
        Version: "2011-06-15",
        RoleArn: ROLE.roleArn,
        RoleSessionName: "vex-fleet-ops",
        ExternalId: "ext-1",
        DurationSeconds: "3600",
      },
    );
    const session = {
      accessKeyId: "ASIASESSION1",
      secretAccessKey: "session-secret-1",
      sessionToken: "session-token-1",
    };
    for (const sent of calls.api) {
      assert.ok(signedBy(sent, session, "ssm"));
      assert.equal(sent.headers.get("x-amz-security-token"), "session-token-1");
    }
    const stored = (await h.connection.read()).config.session as Record<
      string,
      unknown
    >;
    assert.equal(stored.accessKeyId, "ASIASESSION1");
    assert.equal(typeof stored.revision, "string");
  });

  it("renews a session inside five minutes of expiry, and issues once for concurrent requests", async () => {
    const calls = aws();
    const h = await harness(
      calls.fetch,
      {
        credential: KEY,
        session: {
          accessKeyId: "ASIAOLD",
          secretAccessKey: "old",
          sessionToken: "old",
          expiresAt: Date.now() + 4 * 60_000,
          revision: "r0",
        },
      },
      sigV4Method(true),
      ROLE,
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        h.transport.request(h.binding, { target: "ssm", path: "" }),
      ),
    );
    assert.equal(calls.sts.length, 1);
    assert.deepEqual(
      calls.api.map((sent) => sent.headers.get("x-amz-security-token")),
      ["session-token-1", "session-token-1", "session-token-1"],
    );
  });

  it("maps STS refusals: an unusable key is a reconnect, anything else a rejection", async () => {
    const error = (status: number, code: string) => () =>
      new Response(
        `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>private detail</Message></Error></ErrorResponse>`,
        { status },
      );
    const issued =
      (token: string, doctype = "") =>
      () =>
        new Response(
          `${doctype}<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>ASIA1</AccessKeyId><SecretAccessKey>s</SecretAccessKey><SessionToken>${token}</SessionToken><Expiration>${new Date(Date.now() + 3_600_000).toISOString()}</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
        );
    for (const [respond, expected] of [
      [error(403, "InvalidClientTokenId"), "reconnect_required"],
      [error(403, "SignatureDoesNotMatch"), "reconnect_required"],
      [error(403, "AccessDenied"), "provider_rejected"],
      [() => new Response("<nope", { status: 200 }), "invalid_response"],
      [issued("has space"), "invalid_response"],
      [
        issued("&lol;", '<!DOCTYPE r [<!ENTITY lol "lollollol">]>'),
        "invalid_response",
      ],
      [
        () => {
          throw new Error("offline");
        },
        "request_failed",
      ],
    ] as const) {
      const calls = aws({ sts: respond });
      const h = await harness(
        calls.fetch,
        { credential: KEY },
        sigV4Method(true),
        ROLE,
      );
      await assert.rejects(
        h.transport.request(h.binding, { target: "ssm", path: "" }),
        (e: unknown) =>
          errorCode(expected)(e) && !String(e).includes("private detail"),
      );
      assert.equal(calls.api.length, 0);
      assert.equal((await h.connection.read()).config.session, undefined);
    }
  });

  it("refuses to sign without a role to assume", async () => {
    const calls = aws();
    const h = await harness(
      calls.fetch,
      { credential: KEY },
      sigV4Method(true),
    );
    await assert.rejects(
      h.transport.request(h.binding, { target: "ssm", path: "" }),
      errorCode("invalid_credentials"),
    );
    assert.equal(calls.sts.length + calls.api.length, 0);
  });
});

/** An action context signing locally from flat config. */
function local(config: Record<string, unknown>): ActionContext & {
  stored: () => Record<string, unknown>;
} {
  let current = structuredClone(config);
  return {
    connection: {
      name: "account",
      plugin: "fleet",
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

const fleet = awsCredential({
  id: "fleet",
  targets: (config) => {
    const region = (config.region as string | undefined) ?? "us-east-1";
    return {
      ssm: awsTarget("ssm", region),
      ec2: awsTarget("ec2", region),
    };
  },
});

describe("awsCredential declares an AWS connection", () => {
  it("signs with the key, or assumes the role its config names", () => {
    const key = fleet({ accessKeyId: "a", secretAccessKey: "s" });
    assert.equal(key.method, "accessKey");
    assert.equal(key.awsRole, undefined);
    const role = fleet({
      accessKeyId: "a",
      secretAccessKey: "s",
      roleArn: ROLE.roleArn,
      roleExternalId: "ext-1",
      roleDurationSeconds: "1800",
      region: "eu-west-1",
    });
    assert.equal(role.method, "assumeRole");
    assert.deepEqual(role.awsRole, {
      roleArn: ROLE.roleArn,
      sessionName: "runline",
      externalId: "ext-1",
      durationSeconds: 1800,
      region: "eu-west-1",
    });
    assert.equal(
      role.type.methods.assumeRole.targets.ssm.baseUrl,
      "https://ssm.eu-west-1.amazonaws.com/",
    );
    new CredentialRegistry().register(role.type);
  });

  it("refuses a malformed role, region or duration before any request", () => {
    for (const config of [
      { roleArn: "arn:aws:iam::12:role/x" },
      { roleArn: "arn:aws:s3:::bucket" },
      { roleArn: ROLE.roleArn, roleDurationSeconds: 60 },
      { roleArn: ROLE.roleArn, roleDurationSeconds: "1h" },
      { roleArn: ROLE.roleArn, roleSessionName: "has space" },
      { roleArn: ROLE.roleArn, stsRegion: "mars-1" },
      { region: "us_east_1" },
    ])
      assert.throws(
        () => fleet({ accessKeyId: "a", secretAccessKey: "s", ...config }),
        errorCode("invalid_credentials"),
      );
  });

  it("signs locally from flat config, and keeps a role session only under the role it was issued for", async () => {
    const calls = aws();
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      const ctx = local({
        accessKeyId: "AKIDBASE",
        secretAccessKey: "base-secret",
        roleArn: ROLE.roleArn,
      });
      await brokerFor(ctx, fleet).request({ target: "ssm", path: "" });
      await brokerFor(ctx, fleet).request({ target: "ssm", path: "" });
      assert.equal(calls.sts.length, 1);
      assert.equal(
        (ctx.stored().awsSession as { accessKeyId: string }).accessKeyId,
        "ASIASESSION1",
      );
      ctx.connection.config.roleArn = "arn:aws:iam::123456789012:role/another";
      await brokerFor(ctx, fleet).request({ target: "ssm", path: "" });
      assert.equal(calls.sts.length, 2);
      assert.equal(
        new URLSearchParams(calls.sts[1].body.toString()).get("RoleArn"),
        "arn:aws:iam::123456789012:role/another",
      );

      const keyOnly = local({
        accessKeyId: "AKIDBASE",
        secretAccessKey: "base-secret",
      });
      await brokerFor(keyOnly, fleet).request({ target: "ssm", path: "" });
      assert.ok(signedBy(calls.api.at(-1) as Sent, KEY, "ssm"));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("awsCredential signs locally from an AWS CLI profile", () => {
  /**
   * An `aws` executable on PATH answering `configure export-credentials`
   * per profile, as the real CLI does, and counting its runs.
   */
  function fakeCli() {
    const dir = mkdtempSync(join(tmpdir(), "runline-aws-cli-"));
    const runs = join(dir, "runs");
    const expiration = new Date(Date.now() + 3_600_000).toISOString();
    writeFileSync(
      join(dir, "aws"),
      `#!/bin/sh
echo run >> "${runs}"
while [ "$1" != "--profile" ]; do shift; done
case "$2" in
  signed-in) echo '{"Version":1,"AccessKeyId":"ASIAPROFILE","SecretAccessKey":"profile-secret","SessionToken":"profile-token","Expiration":"${expiration}"}' ;;
  for-role) echo '{"Version":1,"AccessKeyId":"ASIAROLEBASE","SecretAccessKey":"role-base-secret","SessionToken":"role-base-token","Expiration":"${expiration}"}' ;;
  concurrent) sleep 0.3; echo '{"Version":1,"AccessKeyId":"ASIASHARED","SecretAccessKey":"shared-secret","SessionToken":"shared-token","Expiration":"${expiration}"}' ;;
  malformed) echo 'not json' ;;
  bad-key) echo '{"Version":1,"AccessKeyId":"ASIA BAD","SecretAccessKey":"s"}' ;;
  huge) head -c 100000 /dev/zero | tr '\\0' 'x' ;;
  *) echo "Error loading SSO Token: Token for $2 does not exist" >&2; exit 255 ;;
esac
`,
    );
    chmodSync(join(dir, "aws"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${dir}:${path}`;
    return {
      runs: () =>
        existsSync(runs)
          ? readFileSync(runs, "utf8").split("\n").length - 1
          : 0,
      restore: () => {
        process.env.PATH = path;
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it("signs with the profile's key, read from the CLI once while it lasts", async () => {
    const cli = fakeCli();
    const calls = aws();
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      const ctx = local({ awsProfile: "signed-in" });
      const declared = fleet(ctx.connection.config);
      assert.equal(declared.awsProfile, "signed-in");
      assert.equal(declared.localSecret, undefined);
      for (let i = 0; i < 2; i++)
        await brokerFor(ctx, fleet).request({ target: "ssm", path: "" });
      const key = {
        accessKeyId: "ASIAPROFILE",
        secretAccessKey: "profile-secret",
        sessionToken: "profile-token",
      };
      for (const sent of calls.api) assert.ok(signedBy(sent, key, "ssm"));
      assert.equal(cli.runs(), 1);
    } finally {
      globalThis.fetch = original;
      cli.restore();
    }
  });

  it("runs the CLI once for concurrent callers that find no key", async () => {
    const cli = fakeCli();
    const calls = aws();
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      await Promise.all(
        Array.from({ length: 3 }, () =>
          brokerFor(local({ awsProfile: "concurrent" }), fleet).request({
            target: "ssm",
            path: "",
          }),
        ),
      );
      assert.equal(cli.runs(), 1);
      assert.deepEqual(
        calls.api.map((sent) => sent.headers.get("x-amz-security-token")),
        ["shared-token", "shared-token", "shared-token"],
      );
    } finally {
      globalThis.fetch = original;
      cli.restore();
    }
  });

  it("assumes a role with the profile's key", async () => {
    const cli = fakeCli();
    const calls = aws();
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      const ctx = local({ awsProfile: "for-role", roleArn: ROLE.roleArn });
      await brokerFor(ctx, fleet).request({ target: "ssm", path: "" });
      assert.ok(
        signedBy(
          calls.sts[0],
          {
            accessKeyId: "ASIAROLEBASE",
            secretAccessKey: "role-base-secret",
            sessionToken: "role-base-token",
          },
          "sts",
        ),
      );
      assert.equal(
        calls.api[0].headers.get("x-amz-security-token"),
        "session-token-1",
      );
    } finally {
      globalThis.fetch = original;
      cli.restore();
    }
  });

  it("asks for a reconnect when the CLI has no login, and refuses what it cannot use", async () => {
    const cli = fakeCli();
    const calls = aws();
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    try {
      for (const [awsProfile, code] of [
        ["signed-out", "reconnect_required"],
        ["malformed", "invalid_response"],
        ["bad-key", "invalid_response"],
        ["huge", "invalid_response"],
      ] as const)
        await assert.rejects(
          brokerFor(local({ awsProfile }), fleet).request({
            target: "ssm",
            path: "",
          }),
          errorCode(code),
        );
      assert.equal(cli.runs(), 4);
      // A failed run is not held: asking again runs the CLI again.
      await assert.rejects(
        brokerFor(local({ awsProfile: "signed-out" }), fleet).request({
          target: "ssm",
          path: "",
        }),
        errorCode("reconnect_required"),
      );
      assert.equal(cli.runs(), 5);
      assert.throws(() => fleet({ awsProfile: "has space" }), {
        code: "invalid_credentials",
      });
      process.env.PATH = "/nonexistent";
      await assert.rejects(
        brokerFor(local({ awsProfile: "no-cli" }), fleet).request({
          target: "ssm",
          path: "",
        }),
        errorCode("invalid_credentials"),
      );
      assert.equal(calls.api.length + calls.sts.length, 0);
    } finally {
      globalThis.fetch = original;
      cli.restore();
    }
  });
});

describe("the AWS protocols", () => {
  function brokered(respond: (sent: Sent) => Response) {
    const calls = aws({ api: respond });
    const original = globalThis.fetch;
    globalThis.fetch = calls.fetch;
    return {
      calls,
      ctx: local({ accessKeyId: "AKIDBASE", secretAccessKey: "base-secret" }),
      restore: () => {
        globalThis.fetch = original;
      },
    };
  }

  it("awsJson posts the operation as the JSON protocol names it, and reads the answer", async () => {
    const h = brokered(() => Response.json({ InstanceInformationList: [] }));
    try {
      const answer = await awsJson(h.ctx, fleet, "fleet", {
        target: "ssm",
        operation: "AmazonSSM.DescribeInstanceInformation",
        version: "1.1",
        input: { MaxResults: 5 },
      });
      assert.deepEqual(answer, { InstanceInformationList: [] });
      const [sent] = h.calls.api;
      assert.equal(
        sent.headers.get("x-amz-target"),
        "AmazonSSM.DescribeInstanceInformation",
      );
      assert.equal(
        sent.headers.get("content-type"),
        "application/x-amz-json-1.1",
      );
      assert.equal(sent.body.toString(), '{"MaxResults":5}');
    } finally {
      h.restore();
    }
  });

  it("awsQuery posts the action's form and answers its Response element as data", async () => {
    const h = brokered(
      () =>
        new Response(
          `<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <requestId>r-1</requestId>
  <reservationSet><item><instancesSet><item><instanceId>i-0abc</instanceId><ownerId>000123456789</ownerId></item></instancesSet></item></reservationSet>
</DescribeInstancesResponse>`,
          { headers: { "content-type": "text/xml" } },
        ),
    );
    try {
      const answer = await awsQuery(h.ctx, fleet, "fleet", {
        target: "ec2",
        action: "DescribeInstances",
        version: "2016-11-15",
        params: {
          "Filter.1.Name": "tag:shift:deployment-id",
          "Filter.1.Value.1": "dep-1",
          DryRun: undefined,
        },
      });
      const [reservation] = awsList(answer.reservationSet);
      const [instance] = awsList(
        (reservation as { instancesSet: unknown }).instancesSet,
      );
      assert.deepEqual(instance, {
        instanceId: "i-0abc",
        ownerId: "000123456789",
      });
      const [sent] = h.calls.api;
      assert.equal(sent.headers.get("accept"), "text/xml");
      assert.deepEqual(
        Object.fromEntries(new URLSearchParams(sent.body.toString())),
        {
          Action: "DescribeInstances",
          Version: "2016-11-15",
          "Filter.1.Name": "tag:shift:deployment-id",
          "Filter.1.Value.1": "dep-1",
        },
      );
    } finally {
      h.restore();
    }
  });

  it("reports a failure by status and AWS error code, never AWS's message", async () => {
    for (const [body, code] of [
      [
        '{"__type":"com.amazonaws.ssm#InvalidInstanceId","message":"private detail"}',
        "InvalidInstanceId",
      ],
      [
        "<Response><Errors><Error><Code>InvalidInstanceID.NotFound</Code><Message>private detail</Message></Error></Errors></Response>",
        "InvalidInstanceID.NotFound",
      ],
    ] as const) {
      const h = brokered(() => new Response(body, { status: 400 }));
      try {
        await assert.rejects(
          body.startsWith("{")
            ? awsJson(h.ctx, fleet, "fleet", {
                target: "ssm",
                operation: "AmazonSSM.GetCommandInvocation",
                version: "1.1",
              })
            : awsQuery(h.ctx, fleet, "fleet", {
                target: "ec2",
                action: "DescribeInstances",
                version: "2016-11-15",
              }),
          (error: Error & { status?: number; code?: string }) =>
            error.message === `fleet: request failed (HTTP 400 ${code})` &&
            error.status === 400 &&
            error.code === code &&
            !error.message.includes("private"),
        );
      } finally {
        h.restore();
      }
    }
  });

  it("awsList reads one entry, many, or none", () => {
    assert.deepEqual(awsList({ item: { a: "1" } }), [{ a: "1" }]);
    assert.deepEqual(awsList({ member: [{ a: "1" }, { a: "2" }] }), [
      { a: "1" },
      { a: "2" },
    ]);
    for (const empty of ["", undefined, {}, { item: "" }])
      assert.deepEqual(awsList(empty), []);
  });
});

describe("token-issuance failures keep the wording hosts recognize", () => {
  it("names a reconnect for an unusable credential", () => {
    assert.match(
      new AuthError("reconnect_required").message,
      /reconnect the account/,
    );
    assert.equal(
      new AuthError("provider_rejected").message,
      "Provider rejected the token request",
    );
  });
});
