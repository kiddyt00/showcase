# @showcase/agent · Agent 工作台（端口 3200）

本地私有部署的完整能力面：AI 分析、多轮对话管理、视频渲染、页面全量管理。

- 保留：`/chat` 控制台、`/api/chat*`、`/api/analyze`、`/api/video`（POST 渲染 + GET 状态）、`/api/pages` 全套、`/api/health`
- 不含：`/sitemap`、`/robots`（不对公众 SEO）
- 数据：直接用 `@showcase/core` 读写同机共享的 `data/showcase.db`（DATA_DIR 指向仓库根 data，双进程 WAL 并发）；渲染产物写入 `PUBLIC_ASSETS_DIR`（默认仓库根 public），site 即刻可见

```bash
pnpm --filter @showcase/agent dev     # 开发（3200）
pnpm --filter @showcase/agent build
pnpm --filter @showcase/agent start   # 生产（3200）
```
