import path from "node:path";
import type { NextConfig } from "next";

// Local development: share the monorepo root .env with the worker. Hosted environments
// (Netlify) inject real environment variables and have no .env file.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  /* no root .env */
}

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@longcut/shared", "@longcut/db", "@longcut/services"],
  serverExternalPackages: ["pg", "bcryptjs"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
