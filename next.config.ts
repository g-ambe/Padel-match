import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() { return ["/auth/reset-password", "/profile/invitations/redeem"].map(source => ({ source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] })); },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default nextConfig;
