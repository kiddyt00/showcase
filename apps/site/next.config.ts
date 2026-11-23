import type { NextConfig } from "next";

/**
 * 旧中文 slug → 新英文 slug 的 308 永久重定向（保 SEO 权重）。
 * 必须在 config 层做：PPR（cacheComponents）下页面渲染阶段的 redirect 只能
 * 走客户端流式跳转，拿不到真正的 HTTP 308。新别名可在迁移时同步追加到这里。
 * （运行时兜底：show/[slug] 页内 findPageByAlias → permanentRedirect）
 */
const SLUG_ALIASES: Record<string, string> = {
  "magpie-给所有-ai-编程-agent-换模型的统一网关-mwsrb6r0": "magpie-unified-gateway-for-ai-coding-agents",
  "next-js-全栈-react-框架的深度解析-mwsz8enq": "nextjs-fullstack-react-framework-deep-dive",
  "superpowers-为编码代理注入完整软件开发方法论-mwszalwe": "superpowers-coding-agent-methodology",
  "测试项目-demotool-深度解析-mwsqq9ab": "demotool-deep-dive-test",
};

const nextConfig: NextConfig = {
  async redirects() {
    // 请求路径到达路由层时中文是百分号编码的，raw 与 encoded 两个变体都要登记
    return Object.entries(SLUG_ALIASES).flatMap(([from, to]) =>
      [from, encodeURI(from)].map((source) => ({
        source: `/show/${source}`,
        destination: `/show/${to}`,
        permanent: true, // 308
      }))
    );
  },
  cacheComponents: true,
  partialPrefetching: true,
  // 独立部署产物：构建后生成 .next/standalone（含最小 server.js），便于 Docker / 服务器部署
  output: "standalone",
  // workspace 共享包以 TS 源码形式被消费，需要 transpile
  transpilePackages: ["@showcase/core"],
  // 原生二进制 / 不参与打包的运行时依赖（含 core 透传引入的）
  serverExternalPackages: ["better-sqlite3", "@remotion/bundler", "@remotion/renderer", "remotion", "msedge-tts"],
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
