/**
 * Release gate for the published legal pages.
 *
 * Razorpay's Payment Aggregator guidelines require the registered legal entity, a
 * physical address, a monitored support email and a support phone to be published
 * on the live site, and they verify each of these before activating a merchant id.
 * `src/lib/site-legal.ts` ships with `FILL`-prefixed placeholders so no invented
 * entity details can reach production unnoticed.
 *
 * Run: npm run verify:legal
 *
 * Deliberately NOT part of `npm run build` or the CI workflow — local work must
 * never be blocked by an unfilled legal field. Wire it into your release
 * checklist instead.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const CONFIG = path.join(ROOT, "src", "lib", "site-legal.ts");
const SENTINEL = "FILL";

const source = readFileSync(CONFIG, "utf8");

// Each published field is a `key: value` line inside the LEGAL object literal.
const fieldPattern = /^\s{2}(\w+):\s*(null|"(?:[^"\\]|\\.)*")/gm;
const fields = [];
for (const match of source.matchAll(fieldPattern)) {
  const [, key, rawValue] = match;
  fields.push({ key, rawValue, value: rawValue === "null" ? null : rawValue.slice(1, -1) });
}

if (fields.length === 0) {
  console.error(`FAIL: parsed no fields out of ${path.relative(ROOT, CONFIG)}.`);
  console.error("The field pattern in this script is out of date with site-legal.ts.");
  process.exit(1);
}

const unfilled = fields.filter((f) => f.value !== null && f.value.trim().startsWith(SENTINEL));

console.log("Legal placeholder check (src/lib/site-legal.ts)");
console.log(`  ${fields.length} published field(s) parsed`);

if (unfilled.length > 0) {
  console.log("");
  for (const field of unfilled) console.log(`  UNFILLED  ${field.key}`);
  console.log("");
  console.log(`FAIL: ${unfilled.length} field(s) still hold a FILL placeholder.`);
  console.log("Replace each with the real registered detail before taking a live order.");
  console.log("Razorpay verification will reject the site while these are unresolved.");
  process.exit(1);
}

console.log("OK: every published legal field is filled in.");
process.exit(0);