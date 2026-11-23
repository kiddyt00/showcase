# ---------- deps：安装依赖（含 better-sqlite3 原生二进制预编译） ----------
FROM node:22-slim AS deps
WORKDIR /app
# better-sqlite3 需要 python3/make/g++ 做原生编译
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/site/package.json apps/site/package.json
COPY packages/core/package.json packages/core/package.json
RUN pnpm install --frozen-lockfile --filter @showcase/site...

# ---------- build：Next.js standalone 构建（apps/site） ----------
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建时不注入 APP_MODE，运行时再决定模式
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @showcase/site build

# ---------- runner：最小运行时 ----------
# monorepo standalone 产物位于 apps/site/.next/standalone（内含精简 node_modules 与 apps/site/server.js）
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    PUBLIC_ASSETS_DIR=/app/public
EXPOSE 3100

# standalone 产物已含 trace 后的 node_modules（含 better-sqlite3 二进制），直接使用
COPY --from=build /app/apps/site/.next/standalone ./
COPY --from=build /app/apps/site/.next/static ./apps/site/.next/static
COPY --from=build /app/apps/site/public ./public

# 数据持久化挂载点：SQLite 库（/app/data/showcase.db）与已渲染视频/图表
# 运行时挂载：docker run -v showcase-data:/app/data -v showcase-assets:/app/public
VOLUME ["/app/data", "/app/public"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# APP_MODE / ADMIN_TOKEN / DATA_DIR / PUBLIC_ASSETS_DIR 均通过 docker run -e 注入；cwd=/app，DATA_DIR 显式指向 /app/data
CMD ["node", "apps/site/server.js"]
