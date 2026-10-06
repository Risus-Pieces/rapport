import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev-only route indicator off the bottom-left, where it covers the sidebar footer and tab bar.
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
