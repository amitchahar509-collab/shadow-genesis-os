import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Never ship the SQLite file into the standalone build: file tracing copied
  // db/custom.db into .next/standalone/db/, creating a second (stale) database
  // that masked the relative-DATABASE_URL split-brain bug. The runtime resolves
  // the real project-root DB itself (see src/lib/db.ts).
  outputFileTracingExcludes: { "*": ["./db/**"] },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
