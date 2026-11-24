import { getPage, findPageByAlias } from "@showcase/core/store";
import { notFound, permanentRedirect } from "next/navigation";
import PageView from "@/components/PageView";
import VideoSection from "@/components/VideoSection";
import ReadingProgress from "@/components/ReadingProgress";
import type { Metadata } from "next";


export const instant = false; // 内容站：整页每次请求动态渲染

/** params 中的动态段可能仍是百分号编码（Next 16 中文 slug 场景），防御性解码 */
function decodeSlug(raw: string): string {
  return /%/.test(raw) ? decodeURIComponent(raw) : raw;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const decoded = decodeSlug(slug);
  const page = (await getPage(decoded)) ?? findPageByAlias(decoded);
  // 别名命中时在 metadata 阶段就发 308（body 流式输出开始前，才能改写 HTTP 状态码）
  if (!page) notFound();
  if (page.slug !== decoded) permanentRedirect(`/show/${page.slug}`);
  return {
    title: page.title,
    description: page.summary,
    openGraph: {
      title: page.title,
      description: page.summary,
      images: page.icon ? [page.icon] : undefined,
    },
  };
}

export default async function ShowPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const decoded = decodeSlug(slug);

  const page = await getPage(decoded);
  if (!page) {
    // 别名（旧中文 slug）已在 generateMetadata 阶段发过 308；到这里仍未命中则 404
    if (!findPageByAlias(decoded)) notFound();
    permanentRedirect(`/show/${findPageByAlias(decoded)!.slug}`);
  }
  return (
    <>
      <ReadingProgress />
      <PageView page={page} />
      <VideoSection slug={page.slug} />
      {/* Agent 编辑深链：配置了 NEXT_PUBLIC_AGENT_URL 才出现（公开 standalone 部署不渲染） */}
      {process.env.NEXT_PUBLIC_AGENT_URL ? (
        <p className="mx-auto max-w-3xl px-4 pb-10 text-right">
          <a
            href={`${process.env.NEXT_PUBLIC_AGENT_URL}/chat?slug=${page.slug}`}
            className="link-editorial text-xs text-muted"
            target="_blank"
            rel="noreferrer"
          >
            在 Agent 工作台中编辑此页 ↗
          </a>
        </p>
      ) : null}
    </>
  );
}
