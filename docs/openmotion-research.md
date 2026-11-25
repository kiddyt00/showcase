# OpenMotion 调研报告

> https://github.com/nexu-io/openmotion · Apache-2.0 · 9.5k stars (2026-11) · OpenDesign 出品

## 一句话定位

**开源版 Claude Motion / CapCut 替代品**：全栈 agentic 视频工作室——上传参考视频或贴社交视频链接，Agent 拆解它的镜头/节奏/排版，用你的品牌套件重建成 HTML 项目，可在 Studio 可视化编辑时间线，渲染输出 MP4（YouTube/Shorts/Reels/TikTok 多规格）。

## 核心工作流

```
参考视频 + 品牌套件 + 文案
    ↓
Agent 拆解参考（镜头顺序/转场/声音提示 → Motion.md）
    ↓
重建 HTML 场景（保留运动意图，替换品牌/文案/素材）
    ↓
缺失素材生成（GPT Image 2.6 图 / Seedance 2.5 视频 / Suno 配乐 / Eleven v4 配音）
    ↓
Studio 时间线编辑（人类精修）
    ↓
MP4 导出 + 可编辑源码留存
```

## 与竞品的关键差异

| 维度 | OpenMotion | CapCut | Claude Motion | 我们(ShowCase) |
|---|---|---|---|---|
| 产物形态 | **可编辑 HTML 项目**（可反复改） | 封闭工程文件 | 封闭 | HTML(Remotion/HF) |
| 驱动方式 | Agent（BYOA 22 个） | 手动 | Claude 专属 | Agent 管线 |
| 参考视频逆向 | ✅ 核心能力 | ❌ | 部分 | ❌ |
| 品牌套件复用 | ✅ BrandKit/Motion.md | 模板 | — | 主题 token |
| 渲染引擎 | **HyperFrames 0.9.7（pinned）** | 自有 | — | Remotion+HF |
| 成本 | 免费+BYOK | 订阅 | Claude 订阅 | 免费 |

## 对 ShowCase 的关键启示

1. **Motion.md 格式**——用 Markdown 描述镜头顺序/时机/转场，可分享可复用。我们的 storyboard JSON 是私有格式，Motion.md 是"可携带的分镜知识"。值得借鉴其 BrandKit 段落设计。
2. **我们已经在用它的底座**——OpenMotion 的渲染引擎就是 HyperFrames 0.9.7（pinned），我们 R4 接入的也是 HF。它的 300+ Motion.md 指南和模板库（OpenAI/Anthropic/Notion/Stripe 的品牌片拆解）是现成的分镜教学素材库。
3. **DSH 官方适配**——README 明确列出 **DeepSeek Harness 是支持的 22 个 agent 之一**（docs/agent-adapters.md#deepseek-harness），通过 Cordis 配置连接 MCP 工具。
4. **能力差距（它有我们没有）**：参考视频逆向重建、Studio 可视化时间线、多模型媒体生成（图/视频/音乐/TTS 生成）、版本历史、多平台规格导出。
5. **我们有它没有的**：确定性快速渲染管线（quick 30s 版零 LLM）、TTS 词级时间戳卡拉OK字幕、文章-视频双形态内容管线、SQLite 内容库。

## 可行借鉴（低成本高回报）

- **Motion.md 作为分镜的中间格式**：我们的 LLM 分镜输出可以先产 Motion.md（人类可读可改），再编译成 Remotion/HF——获得"人工可干预层"
- **模板库思路**：把我们的分镜产物沉淀为可复用模板（它有 template-library/ 目录结构可参考）
- **Studio 概念**：未来若做视频人工精修 UI，它的 Studio（React19+CodeMirror+Dockview）是参考架构
