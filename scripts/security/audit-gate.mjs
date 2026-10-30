#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Runs `npm audit --json` and FAILS when an advisory at or above the configured
 * severity is present that is not covered by the reviewed allowlist in
 * `scripts/security/audit-allowlist.json`.
 *
 * Why an allowlist instead of a bare `npm audit --audit-level=high`:
 *   - the repo carries a couple of known, reviewed advisories whose only
 *     offered fix is a breaking change (see each entry's `reason`), and
 *   - a job that is permanently red trains people to ignore it.
 * So the accepted set is explicit, dated and reviewable, and any NEW
 * high/critical advisory turns the job red. Burn entries down, don't rot them.
 *
 * Only advisories attached to the vulnerable package itself (`via` entries that
 * are objects with a GHSA url) are gated. Packages whose `via` is just a string
 * pointer inherit a dependency's advisory and are reported, not independently
 * failed — the origin package is gated on its own merits.
 *
 * Fail-closed: if `npm audit` cannot run or its JSON cannot be parsed the gate
 * exits non-zero rather than assuming "no vulnerabilities".
 *
 * Env:
 *   AUDIT_LEVEL  lowest severity that fails the gate (info|low|moderate|high|critical)
 *                default: high
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ALLOWLIST_PATH = path.join(ROOT, "scripts", "security", "audit-allowlist.json");

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const SEVERITY_ORDER = Object.keys(RANK);

const thresholdName = (process.env.AUDIT_LEVEL ?? "high").toLowerCase();
const threshold = RANK[thresholdName];
if (threshold === undefined) {
  console.error(`audit-gate: AUDIT_LEVEL="${thresholdName}" is not one of ${SEVERITY_ORDER.join("|")}`);
  process.exit(1);
}

function die(message) {
  console.error(`audit-gate: ${message}`);
  process.exit(1);
}

/** GHSA id embedded in an advisory url, e.g. https://github.com/advisories/GHSA-xxxx-yyyy-zzzz */
function ghsaOf(url) {
  const m = typeof url === "string" ? url.match(/GHSA-[0-9a-z-]+/i) : null;
  return m ? m[0].toUpperCase() : null;
}

let allowlist;
try {
  allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
} catch (e) {
  die(`could not read ${path.relative(ROOT, ALLOWLIST_PATH)}: ${String(e)}`);
}
if (!Array.isArray(allowlist.advisories)) die("allowlist has no `advisories` array");

const today = new Date().toISOString().slice(0, 10);
const allowed = new Map();
for (const entry of allowlist.advisories) {
  if (!entry?.package || !entry?.advisory) die("every allowlist entry needs `package` and `advisory`");
  allowed.set(`${entry.package}::${entry.advisory.toUpperCase()}`, entry);
}

// Windows cannot exec the npm .cmd shim without a shell, and Node warns when
// args are combined with shell:true, so pass a single command string there.
const auditOptions = { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 };
const run =
  process.platform === "win32"
    ? spawnSync("npm audit --json", { ...auditOptions, shell: true })
    : spawnSync("npm", ["audit", "--json"], auditOptions);
if (run.error) die(`could not run npm audit: ${String(run.error)}`);
if (!run.stdout || !run.stdout.trim()) {
  die(`npm audit produced no output${run.stderr ? `: ${run.stderr.trim()}` : ""}`);
}

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  die(`npm audit did not return JSON (exit ${run.status}); first line: ${run.stdout.split("\n")[0]}`);
}
if (report.error) die(`npm audit reported an error: ${JSON.stringify(report.error)}`);

const vulns = report.vulnerabilities ?? {};
const failures = [];
const allowedInUse = new Set();
let inheritedCount = 0;
let belowThresholdCount = 0;

for (const [pkg, vuln] of Object.entries(vulns)) {
  const pkgRank = RANK[vuln.severity] ?? 0;
  if (pkgRank < threshold) {
    belowThresholdCount += 1;
    continue;
  }

  const advisories = (vuln.via ?? []).filter((v) => v && typeof v === "object" && v.url);
  if (advisories.length === 0) {
    inheritedCount += 1;
    continue;
  }

  const gated = advisories.filter((a) => (RANK[a.severity] ?? 0) >= threshold);
  for (const advisory of gated) {
    const id = ghsaOf(advisory.url);
    const key = id ? `${pkg}::${id}` : null;
    const entry = key ? allowed.get(key) : undefined;
    if (!entry) {
      failures.push({
        package: pkg,
        severity: advisory.severity,
        advisory: id ?? "(no GHSA in url)",
        title: advisory.title ?? "",
      });
      continue;
    }
    if (entry.expires && entry.expires < today) {
      failures.push({
        package: pkg,
        severity: advisory.severity,
        advisory: id,
        title: `${advisory.title ?? ""} (allowlist entry EXPIRED ${entry.expires})`,
      });
      continue;
    }
    allowedInUse.add(key);
  }
}

const stale = [...allowed.keys()].filter((k) => !allowedInUse.has(k));
const counts = report.metadata?.vulnerabilities ?? {};

console.log(
  `audit-gate: npm audit reports ${counts.total ?? "?"} vulnerabilities ` +
    `(critical ${counts.critical ?? 0}, high ${counts.high ?? 0}, ` +
    `moderate ${counts.moderate ?? 0}, low ${counts.low ?? 0}); ` +
    `gate threshold = ${thresholdName}`,
);
console.log(
  `audit-gate: ${allowedInUse.size} allowlisted advisor${allowedInUse.size === 1 ? "y" : "ies"}, ` +
    `${inheritedCount} inherited (dependency of an already-gated package), ` +
    `${belowThresholdCount} below threshold`,
);

for (const key of allowedInUse) {
  const e = allowed.get(key);
  console.log(`  ALLOWED  ${key}  expires ${e.expires ?? "never"} — ${e.reason ?? ""}`);
}
for (const key of stale) {
  const e = allowed.get(key);
  console.log(`  STALE    ${key} is allowlisted but no longer reported — remove it (${e.reason ?? ""})`);
}

if (failures.length > 0) {
  console.error(`\naudit-gate: FAIL — ${failures.length} advisory(ies) at or above "${thresholdName}" are not allowlisted:`);
  for (const f of failures) {
    console.error(`  ${f.severity.toUpperCase()} ${f.package} ${f.advisory} — ${f.title}`);
  }
  console.error(
    "\nFix the dependency, or add a reviewed entry to scripts/security/audit-allowlist.json with a reason and expiry.",
  );
  process.exit(1);
}

console.log(`audit-gate: PASS — no unallowlisted advisory at or above "${thresholdName}".`);
