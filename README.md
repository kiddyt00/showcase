# ShowCase · 通用内容分析与展示平台（pnpm monorepo）

输入任意内容源（GitHub 项目 / 文章 URL / 原始文本），AI 自动分析并生成可视化介绍网页，附带 AI 配音解说视频（16:9 / 9:16 双规格）。

## 目录结构

```
github-showcase/
├── pnpm-workspace.yaml        # packages: ["apps/*", "packages/*"]
├── packages/
│   └── core/                  # @showcase/core 共享内核（TS 源码直出）
│       ├── src/               # types / store / agent / agent-tools / analyzers / diagrams / redact / auth / safe-fetch / mode / deepseek / video/*
│       ├── remotion/          # Remotion 幻灯片模板与 entry
│       └── vendor/seecode/    # 内嵌 SeeCode 图表 CLI
├── apps/
│   ├── site/                  # 公开知识站（端口 3100）：首页 / 详情页 / 静态图表视频 / api(pages, health, video GET) / sitemap / robots
│   └── agent/                 # Agent 工作台（端口 3200）：/chat / api(chat, chat/history, analyze, video, pages 全套)
├── data/showcase.db           # 共享 SQLite 数据库（DATA_DIR 指向此处）
├── public/                    # 共享产物目录（PUBLIC_ASSETS_DIR）：videos/ diagrams/
└── scripts/sync-pages.mjs     # 内容同步脚本
```

两个 app 同机共享同一个 `data/showcase.db`（store 已开 WAL，双进程并发读写），agent 渲染的视频/图表写入仓库根 `public/`，site 的静态路由运行时读盘即可访问，无需同步。

## 快速开始

```bash
pnpm install
cp .env.example apps/site/.env.local   # 公开站环境变量
cp .env.example apps/agent/.env.local  # Agent 工作台环境变量（填入 DEEPSEEK_API_KEY / ADMIN_TOKEN）
pnpm build                             # 构建全部 app
pnpm dev:site                          # http://localhost:3100
pnpm dev:agent                         # http://localhost:3200
```

生产启动：`pnpm start:site` / `pnpm start:agent`。

## 核心脚本

| 命令 | 说明 |
|---|---|
| `pnpm dev:site` / `pnpm dev:agent` | 开发模式（3100 / 3200） |
| `pnpm start:site` / `pnpm start:agent` | 生产启动（3100 / 3200） |
| `pnpm build` | `pnpm -r build` 构建全部包 |
| `pnpm sync` | 本地库内容同步到目标站点 |

## 页面

| 路径 | App | 说明 |
|---|---|---|
| `/` | site | 内容首页：最新内容列表 |
| `/show/{slug}` | site | 内容详情页（SEO 元信息 + 解说视频） |
| `/sitemap.xml` `/robots.txt` | site | SEO |
| `/` | agent | 重定向到 `/chat` |
| `/chat` | agent | **Agent 管理控制台**：左侧对话指挥 Agent，右侧页面元素面板 |

## API

| 接口 | App | 说明 |
|---|---|---|
| `GET /api/health` | 两者 | 健康检查（site 额外探测数据库） |
| `GET /api/pages`、`GET/PATCH/DELETE /api/pages/{slug}` | 两者 | 页面查询 / 元素级修改 / 删除 |
| `POST /api/pages` | 两者 | 页面创建（发布前自动脱敏；作为内容接收通道，需 `x-admin-token`） |
| `POST /api/analyze` `{input, sourceType?}` | agent | 一句话分析并发布页面 |
| `POST /api/chat` `{sessionId, message, currentSlug?}` | agent | 多轮对话 + 页面管理工具调用 |
| `GET /api/chat/history?sessionId=` | agent | 会话历史 |
| `POST /api/video` `{slug, orientation}` | agent | 发起解说视频渲染（异步） |
| `GET /api/video?slug=&orientation=` | 两者 | 视频任务状态（site 只读） |
| `/diagrams/*` `/videos/*` | site | 静态产物服务（运行时读盘） |

## 环境变量（两个 app 各自的 .env.local）

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | agent 必填 | AI 分析与对话 |
| `ADMIN_TOKEN` | 必填 | 管理接口令牌（`x-admin-token`），不配置则管理接口一律拒绝（503） |
| `DATA_DIR` | 否 | 数据目录；不配置时自动定位仓库根 `data/`（Docker 内设为 `/app/data`） |
| `PUBLIC_ASSETS_DIR` | 否 | 共享产物目录；默认仓库根 `public/`（Docker 内设为 `/app/public`） |
| `NEXT_PUBLIC_SITE_URL` | site 可选 | metadataBase 与 OpenGraph 绝对链接 |
| `APP_MODE` | 否 | `all`（默认）/ `public`：公开展示部署隐藏 Agent 能力面（`/chat` 与相关 API 返回 404） |

## Docker（构建公开站 apps/site）

```bash
docker build -t showcase-public .

docker run -d --name showcase \
  -p 3100:3100 \
  -e APP_MODE=public \
  -e ADMIN_TOKEN=your-secret-token \
  -v showcase-data:/app/data \
  -v showcase-assets:/app/public \
  showcase-public
```

standalone 产物路径为 `apps/site/.next/standalone`（容器内 `node apps/site/server.js`）；数据挂载 `/app/data`（SQLite），产物挂载 `/app/public`（MP4 / SVG）。

### 内容同步（本地 agent 库 → 公开站）

```bash
SYNC_TARGET=https://your-domain.example.com SYNC_TOKEN=your-secret-token pnpm sync
```
