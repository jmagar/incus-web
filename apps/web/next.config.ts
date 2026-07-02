import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["incus-web.tootie.tv"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
