import type { Metadata } from "next";
import { opsTokenOptional } from "@/lib/ops-auth";
import { NOINDEX } from "@/lib/seo";
import OpsConsole from "./ops-console";

/**
 * The privileged half of the platform: this console mints partner codes and
 * drives the delivery and payment workers by hand. The route is unauthenticated
 * at the HTTP layer (the token is checked per action in the browser), so nothing
 * here should ever be indexed. `NOINDEX` is the shared crawl policy from
 * `lib/seo.ts`, extended with `nocache` because an operator reloading
 * mid-incident must not be served a cached console.
 */
export const metadata: Metadata = {
  title: "Ops console",
  description: "Internal operations console.",
  robots: { ...NOINDEX.robots, nocache: true },
};

/**
 * Marketplace operations console.
 *
 * `open` is resolved here, on the server, and handed to the client console as a
 * prop. Doing it this way rather than fetching it from the browser matters: a
 * client probe gates every action button behind a round-trip, and while that
 * route is cold in dev the request stalls for seconds with the console
 * unusable — the same dead-button failure the console is meant to avoid.
 *
 * Only a boolean crosses the wire, never the token itself.
 */
export default function OpsPage() {
  return <OpsConsole open={opsTokenOptional()} />;
}

/**
 * `open` reads the environment, so this page cannot be prerendered: built
 * static, the boolean is frozen at build time and the console advertises the
 * wrong auth model on the deployment it actually runs on. `open` is a
 * not-a-secret environment read rather than a data fetch, so this costs one
 * render and no extra I/O.
 */
export const dynamic = "force-dynamic";
