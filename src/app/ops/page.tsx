import { opsTokenOptional } from "@/lib/ops-auth";
import OpsConsole from "./ops-console";

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
