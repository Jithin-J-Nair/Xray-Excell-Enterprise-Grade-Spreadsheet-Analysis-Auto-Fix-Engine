import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidBasicAuth, productionAuthIsMissing } from "../src/proxy";

const basic = (value: string) => `Basic ${Buffer.from(value, "utf8").toString("base64")}`;

describe("deployment access protection", () => {
  it("accepts the exact configured Basic Auth credentials", () => {
    assert.equal(isValidBasicAuth(basic("ci:ci-only-password"), "ci", "ci-only-password"), true);
  });

  it("rejects missing, malformed, and incorrect credentials", () => {
    assert.equal(isValidBasicAuth(null, "ci", "ci-only-password"), false);
    assert.equal(isValidBasicAuth("Bearer token", "ci", "ci-only-password"), false);
    assert.equal(isValidBasicAuth(basic("ci:wrong"), "ci", "ci-only-password"), false);
    assert.equal(isValidBasicAuth(basic("other:ci-only-password"), "ci", "ci-only-password"), false);
  });

  it("supports UTF-8 credentials", () => {
    assert.equal(isValidBasicAuth(basic("管理者:安全なパスワード"), "管理者", "安全なパスワード"), true);
  });

  it("fails closed in production when either credential is missing", () => {
    assert.equal(productionAuthIsMissing("production", undefined, "secret"), true);
    assert.equal(productionAuthIsMissing("production", "user", undefined), true);
    assert.equal(productionAuthIsMissing("production", "user", "secret"), false);
    assert.equal(productionAuthIsMissing("development", undefined, undefined), false);
  });
});
