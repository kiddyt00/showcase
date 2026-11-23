# @showcase/site · 公开知识站（端口 3100）

公开内容展示站：首页 / 详情页 / 图表与视频静态服务 / 内容接收 API / SEO。

- 保留：`/`、`/show/{slug}`、`/diagrams/*`、`/videos/*`、`/api/pages*`（POST/PATCH/DELETE 带 `x-admin-token` 作为内容接收通道）、`/api/health`、`/api/video`（仅 GET 状态查询）、`/sitemap.xml`、`/robots.txt`
- 不含：`/chat`、`/api/chat*`、`/api/analyze`、`/api/video` POST（视频渲染在 agent 端）
- 数据：直接用 `@showcase/core` 读写同机共享的 `data/showcase.db`（DATA_DIR 指向仓库根 data，双进程 WAL 并发）

```bash
pnpm --filter @showcase/site dev     # 开发（3100）
pnpm --filter @showcase/site build
pnpm --filter @showcase/site start   # 生产（3100）
```
