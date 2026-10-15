import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Disabled deliberately. Every page on this site reads the visitor's locale
   * cookie and then queries SQLite, so essentially every route is dynamic.
   * Cache Components would force a Suspense boundary around each of those reads
   * for no real gain here, since there is no static shell worth streaming.
   */
  cacheComponents: false,

  images: {
    // Medicine photos are served from the upstream pharmacy CDN.
    remotePatterns: [{ protocol: "https", hostname: "cdn2.arogga.com" }],
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;