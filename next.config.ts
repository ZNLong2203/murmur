import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vercel restores .next/cache between builds, and the warm Turbopack cache
    // reused the old Tailwind stylesheet: classes that only appear in new
    // files were missing in production. A cold build takes a few seconds more.
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
