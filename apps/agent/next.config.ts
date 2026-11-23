import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // 独立部署产物：构建后生成 .next/standalone（含最小 server.js），便于 Docker / 服务器部署
  output: "standalone",
  // workspace 共享包以 TS 源码形式被消费，需要 transpile
  transpilePackages: ["@showcase/core"],
  // 原生二进制 / 不参与打包的运行时依赖（含 core 透传引入的）
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "remotion",
    "better-sqlite3",
    "msedge-tts",
  ],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
