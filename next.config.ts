import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The CSV import checks its own 1 MB limit; this keeps Next from rejecting a slightly larger file first.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  // Keep the dev-only route indicator off the bottom-left, where it covers the sidebar footer and tab bar.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
