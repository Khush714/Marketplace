import type { NextConfig } from "next";
import { IMAGE_HOST_PATTERNS } from "./src/lib/image-policy.ts";

const nextConfig: NextConfig = {
  // Security headers (CSP, HSTS, frame and referrer policy) are owned by the
  // Proxy — src/proxy.ts, via withSecurityHeaders — because it sees every
  // response, including the refusals, and can gate HSTS on the request
  // protocol. They are not repeated here; what config owes the boundary is not
  // undoing it: no framework fingerprint, and image origins stay constrained.
  poweredByHeader: false,
  images: {
    // `next/image` fetches remote images from the SERVER, so this list is a
    // fetch surface, not just a rendering allowlist. It mirrors the canonical
    // policy in `src/lib/image-policy.ts` — the same list `sanitizeImageUrl`
    // enforces on every write — so there is no host the app will store but the
    // optimizer refuses, and no host the optimizer would fetch that the app
    // would not. Never widen this to `**`: an arbitrary host makes the
    // optimizer a server-side request forgery primitive and an open proxy.
    remotePatterns: IMAGE_HOST_PATTERNS.map((pattern) => ({
      protocol: pattern.protocol,
      hostname: pattern.hostname,
    })),
    // Next 16 resolves DNS before fetching and refuses every non-unicast
    // address (loopback, RFC 1918, link-local/metadata) unless this flag is on.
    // It defaults to false today; set explicitly so a future upgrade that
    // changed the default could not silently open the fetch to our own network.
    dangerouslyAllowLocalIP: false,
  },
};

export default nextConfig;
