import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function parseExample() {
  const txt = readFileSync(join(root, ".env.example"), "utf8");
  const req = new Set();
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m) {
      const key = m[1];
      // Non-secret/optional markers in comments? But treat all keys in example as documented; filter dev-only if desired
      req.add(key);
    }
  }
  return Array.from(req).sort();
}

const keys = parseExample();
console.log("Documented env keys (from .env.example):");
console.log(keys.join("\n"));
console.log(`\nTotal: ${keys.length}`);
process.exit(0);
