import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server for the Cloud Run container.
  output: "standalone",
  // Firestore uses gRPC with native bits; keep it out of the bundle.
  serverExternalPackages: ["@google-cloud/firestore"],
};

export default nextConfig;
