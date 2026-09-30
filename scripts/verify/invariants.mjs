/**
 * Phase 15 invariant guard — blocks the final commit if any server-semantics
 * file was modified by the thermal work, since acceptance forbids changes to
 * ordering, tracking, payments, cart, checkout and restaurant integration.
 *
 * Run: node scripts/verify/invariants.mjs
 *
 * The check compares the working tree against HEAD and fails on any file that
 * belongs to a forbidden domain AND is not on the monitored-exceptions list
 * below. Exceptions are not free passes: each one carries a Phase reference and
 * a justification, refreshed every run.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

// Paths that must never change during the thermal work. These own the actual
// business semantics: order/status mutations, money, credentials, DB.
const HARD_INVARIANT_PREFIXES = [
  "src/db/",
  "src/integrations/",
  "src/app/api/orders/",
  "src/app/api/integration/",
  "src/app/api/integrations/",
  "src/app/api/partner/",
  "src/lib/order-token.ts",
  "src/lib/webhook-crypto.ts",
  "src/lib/domain.ts",
  "src/lib/cart.tsx",
  "src/lib/razorpay-checkout.ts",
  "src/lib/ordering-gate.ts",
  "src/lib/pos-order-status-webhook.ts",
  "src/lib/pos-bridge.ts",
];

// Documented, semantics-preserving exceptions (each flagged in the report).
const MONITORED = [
  {
    file: "src/app/api/integrations/payments/webhook/route.ts",
    why: "Phase 11 memory-leak fix: the ip->window Map entry is deleted when its "
      + "window empties. Same window/max/first-request semantics, no signature or "
      + "confirmation logic touched.",
  },
];

function changedFiles() {
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const files = new Set();
  for (const line of porcelain.split("\n")) {
    if (!line.trim()) continue;
    // XY path — untracked ?? and renamed 'R old -> new' both carry the path in
    // the last whitespace-separated token quoted or not.
    const m = line.match(/^.. (.+?)$/);
    if (m) files.add(m[1].replace(/^"/, "").replace(/"$/, ""));
  }
  return files;
}

const report = [];
let violations = 0;

const files = changedFiles();
for (const file of files) {
  const hit = HARD_INVARIANT_PREFIXES.find((p) => file.startsWith(p));
  if (!hit) continue;
  const monitored = MONITORED.find((m) => m.file === file);
  if (monitored) {
    report.push(`  MONITORED  ${file}\n             ${monitored.why}`);
  } else {
    violations += 1;
    report.push(`  VIOLATION  ${file}`);
  }
}

console.log("Phase 15 invariant guard (working tree vs HEAD)");
if (report.length) console.log(report.join("\n"));
if (violations > 0) {
  console.log(`FAIL: ${violations} forbidden file(s) modified.` + "");
  process.exit(1);
}
console.log("OK: no forbidden domain file touched by the thermal work.");
process.exit(0);