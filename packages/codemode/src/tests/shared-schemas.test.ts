import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Check } from "typebox/value";
import { isoDay, rfc3339 } from "../../../codemode-plugins/_shared/schemas.js";

describe("shared date schemas", () => {
  it("takes a calendar day and nothing around it", () => {
    const day = isoDay();
    assert.equal(Check(day, "2026-11-19"), true);
    for (const value of ["2026-11-19T00:00:00Z", "19-11-2026", "2026-1-9", ""])
      assert.equal(Check(day, value), false, value);
  });

  it("takes an RFC 3339 time only with its offset", () => {
    const time = rfc3339("When");
    assert.equal((time as { description?: string }).description, "When");
    for (const value of [
      "2026-11-19T09:12:31Z",
      "2026-11-19T09:12:31.250Z",
      "2026-11-19T09:12:31+02:00",
    ])
      assert.equal(Check(time, value), true, value);
    for (const value of [
      "2026-11-19T09:12:31",
      "2026-11-19",
      "2026-11-19T09:12:31Z trailing",
    ])
      assert.equal(Check(time, value), false, value);
  });
});
