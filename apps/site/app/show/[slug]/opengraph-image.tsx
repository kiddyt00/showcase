/**
 * 动态 OG 分享卡（r1-open 构想一）：/show/{slug} 的 opengraph-image 约定路由
 *
 * 版式（editorial 印刷风）：
 * - 1200×630，米白底 + 顶部双细线（masthead-rule：粗细双线）
 * - 栏目 kicker（小号大写 + 宽字距）→ 衬线大标题（最多 3 行截断）→ 底部落款
 * - 有 section.image 时右侧 45% 放图（objectFit: cover），无图纯排版
 *
 * ── 字体取舍（重要）──────────────────────────────────────────────
 * next/og 内置的默认字体只有 Geist（拉丁字形）。中文标题走它内置的
 * 动态子集机制：按实际用到的字形向 Google Fonts 拉取 Noto Sans SC 子集
 * （实测仅数 KB，且逐字形缓存；离线机器上拉取失败只会回退成空白字形，
 * 不会使路由 500——stderr 告警后仍正常产出 PNG）。
 * 不随包打整包中文字体（思源宋体全量 >10MB，超出 ImageResponse 资产
 * 上限），故首版排版用「英文站名/数字 + 中文标题」的组合：
 * - 站名 "ShowCase"、期号、年月等拉丁/数字 → Geist（内置，离线可用）
 * - 中文标题/栏目名 → Noto Sans SC 子集（在线时清晰渲染，离线降级）
 * 部署环境可接受该降级：社交卡片缺字形时仍能读出拉丁部分。
 * ────────────────────────────────────────────────────────────────
 */
import { ImageResponse } from "next/og";
import fs from "node:fs";
import path from "node:path";
import { getPage, findPageByAlias } from "@showcase/core/store";
import { PUBLIC_ASSETS_DIR } from "@showcase/core/paths";
import { categoryLabel } from "@/lib/collections";

export const alt = "ShowCase 分享卡";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** 与 show/[slug]/page.tsx 相同的解码规则：params 动态段可能是百分号编码 */
function decodeSlug(raw: string): string {
  return /%/.test(raw) ? decodeURIComponent(raw) : raw;
}

/**
 * section.image 是 public 相对路径（如 videos/{slug}-assets/img-0.jpg）。
 * next/og 的 <img src> 只接受 http(s) / data: 绝对地址（file:// 会直接抛
 * "Image source must be an absolute URL" 且导致响应管道失败），本地文件
 * 一律读出并内联成 base64 data URI（站点配图为 100~300KB 级 JPEG，可接受）。
 * 远程 http(s) 图片原样返回（satori 在线抓取，失败仅告警并留空图区）。
 * 读不到本地文件时返回 null → 调用方退回纯排版布局。
 */
function resolveLocalImage(img: string): string | null {
  if (/^https?:\/\//.test(img)) return img;
  const abs = path.resolve(PUBLIC_ASSETS_DIR, img);
  const rel = path.relative(PUBLIC_ASSETS_DIR, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // 防穿越
  const MIME: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  const mime = MIME[path.extname(abs).toLowerCase()];
  if (!mime) return null;
  try {
    return `data:${mime};base64,${fs.readFileSync(abs).toString("base64")}`;
  } catch {
    return null; // 文件缺失 → 退回纯排版（图区留空不如整卡干净）
  }
}

/** createdAt ISO 串 → 「YYYY 年 M 月」落款 */
function yearMonth(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decoded = decodeSlug(slug);
  const page = (await getPage(decoded)) ?? findPageByAlias(decoded);
  if (!page) {
    // 无对应页面：给一张极简站点卡（避免社交平台抓到 500）
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#faf9f6",
            color: "#1c1917",
          }}
        >
          <div style={{ display: "flex", fontSize: 88, fontWeight: 700 }}>
            ShowCase
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#78716c", marginTop: 18 }}>
            AI 驱动的知识分享站
          </div>
        </div>
      ),
      { ...size }
    );
  }

  const kicker = categoryLabel(page.category).toUpperCase();
  const dateLabel = yearMonth(page.createdAt);
  // 首个带图章节：本地文件成功内联 / 远程可及才算有图，否则纯排版
  const heroSrc = (() => {
    for (const s of page.sections) {
      if (!s.image) continue;
      const src = resolveLocalImage(s.image);
      if (src) return src;
    }
    return null;
  })();
  const heroImg = heroSrc !== null;

  // 编辑风布局参数（px，1200×630 画布）
  const PAD = 84;
  const IMG_W = Math.round(1200 * 0.45); // 45% 宽放图

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#faf9f6",
          color: "#1c1917",
          fontFamily: "Georgia, serif",
        }}
      >
        {/* 刊头双细线：上粗下细，印刷品 masthead rule */}
        <div
          style={{
            display: "flex",
            height: 7,
            borderTop: "5px solid #1c1917",
            borderBottom: "1px solid #1c1917",
          }}
        />
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: heroImg ? "row" : "column",
          }}
        >
          {/* 左列：kicker + 标题 + 落款 */}
          <div
            style={{
              display: "flex",
              flex: 1,
              minWidth: 0,
              flexDirection: "column",
              justifyContent: "space-between",
              padding: `${PAD - 20}px ${PAD}px ${PAD - 26}px ${PAD}px`,
            }}
          >
            {/* kicker：栏目小字（大写 + 宽字距） */}
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: 10,
                color: "#b3452e",
                textTransform: "uppercase",
              }}
            >
              {kicker}
            </div>

            {/* 大标题：衬线，最多 3 行截断 */}
            <div
              style={{
                display: "flex",
                fontSize: heroImg ? 64 : 76,
                lineHeight: 1.22,
                fontWeight: 700,
                color: "#1c1917",
                marginTop: 28,
                overflow: "hidden",
                lineClamp: 3,
              }}
            >
              {page.title}
            </div>

            {/* 底部落款：站名 · 年月（与 kicker 呼应的细字距） */}
            <div
              style={{
                display: "flex",
                fontSize: 22,
                letterSpacing: 3,
                color: "#78716c",
                marginTop: 28,
              }}
            >
              ShowCase{dateLabel ? ` · ${dateLabel}` : ""}
            </div>
          </div>

          {/* 右侧 45% 配图：objectFit cover；无图时整块不渲染（纯排版） */}
          {heroImg ? (
            <div
              style={{
                display: "flex",
                width: IMG_W,
                alignItems: "stretch",
              }}
            >
              <img
                src={resolveLocalImage(heroImg)}
                width={IMG_W}
                height={630 - 7}
                style={{
                  width: IMG_W,
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...size }
  );
}
