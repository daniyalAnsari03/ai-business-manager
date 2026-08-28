import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev server and the production build in separate build
  // directories. Running `next dev` (port 3000) and `next start` (the
  // production/QA build) side-by-side on the SAME `.next` silently corrupts
  // the production build: the dev process rewrites manifests/static chunks,
  // so the served prod HTML references chunks that no longer exist and every
  // `_next/static` asset returns 400 (blank/broken pages, slow/hanging
  // navigation). Isolating the directories prevents the collision entirely.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: {

    // Product images live in Supabase Storage; avatars come from Google.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
    ],
  },
  // Let webpack split/tree-shake these libraries into focused entry chunks so
  // the homepage and shared baseline don't carry the whole library payload.
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;
