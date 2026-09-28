import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
