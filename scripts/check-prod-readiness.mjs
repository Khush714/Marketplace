import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function check(cmd, args, opts={}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: r.stdout||"", err: r.stderr||"" };
}

console.log("=== Prod Readiness Check ===");
console.log("1. Typecheck...");
let c = check("npx", ["tsc", "--noEmit"]);
console.log(c.code===0 ? "OK" : "FAIL");

console.log("\n2. Lint...");
c = check("npx", ["eslint", "."]);
console.log(c.code===0 ? "OK" : "FAIL");

console.log("\n3. Invariants...");
c = check("node", ["scripts/verify/invariants.mjs"]);
console.log(c.code===0 ? "OK" : "FAIL");

console.log("\n4. Build...");
c = check("npm", ["run", "build"]);
console.log(c.code===0 ? "OK" : (c.out.split("\n").slice(-30).join("\n")));

console.log("\n5. Tests...");
c = check("npx", ["tsx", "--test", "tests/*.test.ts"]);
console.log(c.out.split("\n").slice(-15).join("\n"));

console.log("\n=== Done ===");
