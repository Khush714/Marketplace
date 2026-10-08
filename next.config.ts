import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Security headers (CSP, HSTS, frame and referrer policy) are owned by the
  // Proxy — src/proxy.ts, via withSecurityHeaders — because it sees every
  // response, including the refusals, and can gate HSTS on the request
  // protocol. They are not repeated here; what config owes the boundary is not
  // undoing it: no framework fingerprint, and image origins stay constrained.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Seeded/curated artwork.
      { protocol: "https", hostname: "images.pexels.com" },
      // Partner-authored dish photos. A partner pastes a link to any HTTPS
      // image host, and the marketplace must not reject it. Hostnames are
      // matched server-side too: `sanitizeImageUrl` in `lib/domain.ts` only
      // accepts absolute http(s) URLs, and the client never sets untrusted
      // `srcSet`/`sizes` on these images.
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
