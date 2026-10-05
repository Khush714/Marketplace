/* Throwaway: assert the emitted social meta tags and that /og.png serves. */
import { spawn } from "node:child_process";

const base = "http://localhost:3003";
const child = spawn("npx", ["--no-install", "next", "start", "-p", "3003"], {
  cwd: process.cwd(),
  stdio: "ignore",
  shell: true,
});

try {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await fetch(`${base}/robots.txt`, { signal: AbortSignal.timeout(1500) });
      break;
    } catch {}
  }

  const png = await fetch(`${base}/og.png`);
  console.log(`/og.png -> ${png.status} ${png.headers.get("content-type")} ${(await png.arrayBuffer()).byteLength}B`);

  // /terms is prerendered, so its head reflects the root metadata with no
  // database involved.
  const html = await (await fetch(`${base}/terms`)).text();
  const tags = [...html.matchAll(/<meta[^>]+(?:property|name)="(og:[^"]+|twitter:[^"]+)"[^>]*>/g)].map((m) => m[0]);
  console.log("\nemitted social meta tags:");
  for (const t of tags) console.log("  " + t);
  const linkTags = [...html.matchAll(/<link[^>]+rel="canonical"[^>]*>/g)].map((m) => m[0]);
  for (const t of linkTags) console.log("  " + t);
} finally {
  child.kill();
  if (process.platform === "win32") {
    await new Promise((r) => spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("exit", r));
  }
}
process.exit(0);