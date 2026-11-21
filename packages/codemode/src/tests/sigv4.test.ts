/**
 * SigV4 against AWS's published signature test suite (the aws4_testsuite
 * botocore vendors, Apache-2.0, LICENSE and NOTICE alongside): every case
 * is a raw request and the exact Authorization header it must produce.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  amzDate,
  canonicalSigV4Request,
  signSigV4,
} from "../credentials/sigv4.js";

const SUITE = join(
  import.meta.dirname,
  "credential-fixtures",
  "aws4_testsuite",
);
const KEY = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const SCOPE = { service: "service", region: "us-east-1" };
const AT = new Date("2015-08-30T12:36:00Z");

/**
 * A suite request, read as botocore's harness reads it: the request line,
 * header lines (a line opening with whitespace continues the previous
 * value), then the body after the first blank line.
 */
function parse(raw: string) {
  const [requestLine, ...lines] = raw.split("\n");
  // The target runs to the protocol version: it may hold a raw space.
  const method = requestLine.slice(0, requestLine.indexOf(" "));
  const target = requestLine.slice(
    method.length + 1,
    requestLine.lastIndexOf(" HTTP/"),
  );
  const blank = lines.indexOf("");
  const headerLines = blank < 0 ? lines : lines.slice(0, blank);
  const body = blank < 0 ? "" : lines.slice(blank + 1).join("\n");
  const headers: Array<[string, string]> = [];
  for (const line of headerLines) {
    if (/^\s/.test(line) && headers.length) {
      const last = headers[headers.length - 1];
      last[1] = `${last[1]} ${line.trim()}`;
    } else {
      const colon = line.indexOf(":");
      headers.push([line.slice(0, colon), line.slice(colon + 1)]);
    }
  }
  const at = target.indexOf("?");
  return {
    method,
    path: at < 0 ? target : target.slice(0, at),
    query: new URLSearchParams(at < 0 ? "" : target.slice(at + 1)),
    headers,
    body,
  };
}

/** Every directory holding a request, by its path in the suite (`normalize-path/get-slash`). */
const cases = readdirSync(SUITE, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".req"))
  .map((path) => path.slice(0, path.lastIndexOf("/")))
  .sort();

describe("SigV4 matches AWS's published test suite", () => {
  it("covers every vendored case", () => {
    assert.equal(cases.length, 31);
  });

  for (const name of cases) {
    it(name, () => {
      const leaf = name.slice(name.lastIndexOf("/") + 1);
      const read = (ext: string) =>
        readFileSync(join(SUITE, name, `${leaf}.${ext}`), "utf8");
      const request = parse(read("req"));
      const sent = (header: string) =>
        request.headers.find(([key]) => key.toLowerCase() === header)?.[1];
      assert.equal(sent("x-amz-date"), amzDate(AT));
      // The suite's one session case names its token only in the
      // canonical request, as botocore's harness reads it.
      const token = name.endsWith("session-token")
        ? /^x-amz-security-token:(.*)$/m.exec(read("creq"))?.[1]
        : undefined;
      const added = signSigV4(
        {
          method: request.method,
          host: sent("host") ?? "",
          path: request.path,
          query: request.query,
          // Host and the date are the signer's own to add.
          headers: request.headers.filter(
            ([key]) => !["host", "x-amz-date"].includes(key.toLowerCase()),
          ),
          body: Buffer.from(request.body),
        },
        { ...KEY, ...(token ? { sessionToken: token } : {}) },
        SCOPE,
        AT,
      );
      assert.equal(added.authorization, read("authz").trim());
      assert.equal(added["x-amz-date"], "20150830T123600Z");
      assert.equal(added["x-amz-security-token"], token);
    });
  }

  it("signs S3's payload hash, and its path exactly as sent where every other service encodes it again", () => {
    const canonical = (service: string) =>
      canonicalSigV4Request(
        {
          method: "PUT",
          host: "bucket.s3.us-east-1.amazonaws.com",
          path: "/a%20b",
          query: [],
          headers: [],
          body: Buffer.from("hi"),
        },
        KEY,
        { service, region: "us-east-1" },
        AT,
      );
    const s3 = canonical("s3");
    const hash =
      "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4";
    assert.equal(s3.added["x-amz-content-sha256"], hash);
    assert.equal(s3.signed, "host;x-amz-content-sha256;x-amz-date");
    assert.equal(s3.canonicalRequest.split("\n")[1], "/a%20b");
    const ec2 = canonical("ec2");
    assert.equal(ec2.added["x-amz-content-sha256"], undefined);
    assert.equal(ec2.canonicalRequest.split("\n")[1], "/a%2520b");
    assert.equal(ec2.canonicalRequest.split("\n").at(-1), hash);
  });
});
