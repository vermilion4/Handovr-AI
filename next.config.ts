import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PayPal login returns to 127.0.0.1, so the dev server must serve that host too.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
