/**
 * The customer auth dialog is still a two-step phone OTP flow, with an optional
 * Google Sign-In button added above it. The mobile number is the only phone
 * identity field for sign-in; a name is collected only when creating an
 * account. These source checks keep the conditional from being widened back to
 * the sign-in path and keep Google from replacing the OTP UI.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/components/customer-auth-dialog.tsx"),
  "utf8"
);

const phoneStep = source.slice(
  source.indexOf('key="phone"'),
  source.indexOf("{error &&")
);
const codeStep = source.slice(
  source.indexOf('key="code"'),
  source.indexOf("{devCode &&")
);

const signupOnlyMarker = '{intent === "signup" && (';

test("sign-in phone step asks only for the mobile number", () => {
  assert.match(phoneStep, /Mobile number/);
  assert.doesNotMatch(phoneStep, /Your name/);
  assert.doesNotMatch(phoneStep, /autoComplete="name"/);
});

test("sign-in OTP step does not render the name field", () => {
  const signupIndex = codeStep.indexOf(signupOnlyMarker);
  assert.notEqual(signupIndex, -1, "the name field must be signup-only");

  const beforeSignup = codeStep.slice(0, signupIndex);
  assert.match(beforeSignup, /Verification code/);
  assert.doesNotMatch(beforeSignup, /Your name/);
  assert.doesNotMatch(beforeSignup, /\(optional\)/);
});

test("signup OTP step still collects a required name", () => {
  const signupIndex = codeStep.indexOf(signupOnlyMarker);
  const signupBlock = codeStep.slice(signupIndex, codeStep.indexOf("{devCode &&"));

  assert.match(signupBlock, /Your name/);
  assert.match(signupBlock, /required\b/);
  assert.match(signupBlock, /autoComplete="name"/);
});

test("Google sign-in is added without removing the phone OTP fields", () => {
  assert.match(phoneStep, /Continue with Google/);
  assert.match(phoneStep, /Mobile number/);
  assert.match(codeStep, /Verification code/);

  const signupIndex = codeStep.indexOf(signupOnlyMarker);
  assert.notEqual(signupIndex, -1, "the name field must remain signup-only");
  const signupBlock = codeStep.slice(signupIndex);
  assert.match(signupBlock, /Your name/);
  assert.match(signupBlock, /autoComplete="name"/);
});
