import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePluginSource } from "../plugin/installer.js";

describe("parsePluginSource", () => {
  it("parses npm source", () => {
    const result = parsePluginSource("npm:runline-plugin-github");
    assert.equal(result.type, "npm");
    assert.equal(result.name, "runline-plugin-github");
    assert.equal(result.ref, undefined);
  });

  it("parses npm source with version", () => {
    const result = parsePluginSource("npm:runline-plugin-github@1.2.3");
    assert.equal(result.type, "npm");
    assert.equal(result.name, "runline-plugin-github");
    assert.equal(result.ref, "1.2.3");
  });

  it("parses scoped npm source", () => {
    const result = parsePluginSource("npm:@acme/plugin");
    assert.equal(result.type, "npm");
    assert.equal(result.name, "@acme/plugin");
    assert.equal(result.ref, undefined);
  });

  it("parses scoped npm source with version", () => {
    const result = parsePluginSource("npm:@acme/plugin@2.0.0");
    assert.equal(result.type, "npm");
    assert.equal(result.name, "@acme/plugin");
    assert.equal(result.ref, "2.0.0");
  });

  it("parses git source with subpath", () => {
    const result = parsePluginSource(
      "git:github.com/Michaelliv/runline#plugins/brandfetch",
    );
    assert.equal(result.type, "git");
    assert.equal(result.name, "brandfetch");
    assert.equal(result.url, "https://github.com/Michaelliv/runline.git");
    assert.equal(result.subpath, "plugins/brandfetch");
  });

  it("parses git source without subpath", () => {
    const result = parsePluginSource("git:github.com/acme/my-plugin");
    assert.equal(result.type, "git");
    assert.equal(result.name, "my-plugin");
    assert.equal(result.url, "https://github.com/acme/my-plugin.git");
    assert.equal(result.subpath, undefined);
  });

  it("parses https URL as git source", () => {
    const result = parsePluginSource(
      "https://github.com/acme/tool.git#plugins/foo",
    );
    assert.equal(result.type, "git");
    assert.equal(result.name, "foo");
    assert.equal(result.url, "https://github.com/acme/tool.git");
    assert.equal(result.subpath, "plugins/foo");
  });

  it("parses local path", () => {
    const result = parsePluginSource("./my-plugin");
    assert.equal(result.type, "local");
    assert.equal(result.name, "my-plugin");
    assert.ok(result.path?.endsWith("my-plugin"));
  });

  it("parses local file path with extension", () => {
    const result = parsePluginSource("./plugins/custom.ts");
    assert.equal(result.type, "local");
    assert.equal(result.name, "custom");
  });

  it("does not append .git twice", () => {
    const result = parsePluginSource("git:github.com/acme/tool.git");
    assert.equal(result.url, "https://github.com/acme/tool.git");
  });
});
