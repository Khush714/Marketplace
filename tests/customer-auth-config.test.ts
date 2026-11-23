/**
 * Customer sign-in is on the critical path for every order. The code fails
 * closed correctly, but a missing env example means a deploy can look healthy
 * until the first customer tries to sign in. Pin every variable the OTP module
 * reads to the documented config surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const OTP_ENV_NAMES = [
  "CUSTOMER_AUTH_OTP_SECRET",
  "CUSTOMER_AUTH_SMS_WEBHOOK_URL",
  "CUSTOMER_AUTH_SMS_WEBHOOK_AUTH",
  "CUSTOMER_AUTH_SMS_WEBHOOK_BEARER_TOKEN",
  "CUSTOMER_AUTH_SMS_TIMEOUT_MS",
  "CUSTOMER_AUTH_EXPOSE_OTP_ON_SCREEN",
];

test("every customer-auth env var read by the OTP module is documented", () => {
  const otp = source("src/lib/customer-auth-otp.ts");
  const example = source(".env.example");
  for (const name of OTP_ENV_NAMES) {
    assert.match(otp, new RegExp(name), `${name} is no longer read by the OTP module`);
    assert.match(example, new RegExp(name), `.env.example must document ${name}`);
  }
});

test("production customer auth fails closed without a secret or delivery path", () => {
  const otp = source("src/lib/customer-auth-otp.ts");
  assert.match(otp, /if \(!secret\) return false/);
  assert.match(otp, /isCustomerSmsConfigured\(\) \|\| onScreenOtpAllowed\(\)/);
});
