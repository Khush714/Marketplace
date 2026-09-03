import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Legacy storefront URLs → canonical consumer routes.
      { source: "/restaurant/:slug", destination: "/restaurants/:slug", permanent: true },
      { source: "/restaurant/:slug/menu", destination: "/restaurants/:slug/menu", permanent: true },
    ];
  },
};

export default nextConfig;
