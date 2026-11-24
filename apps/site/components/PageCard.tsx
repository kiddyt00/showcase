/** 列表卡片：首页 / 栏目页 / 标签页共用（editorial 主题变量） */
import Link from "next/link";
import type { PageSummary } from "@showcase/core/store";
import { categoryLabel } from "@/lib/collections";

export default function PageCard({ page }: { page: PageSummary }) {
  return (
    <Link
      href={`/show/${page.slug}`}
      className="card-lift group block rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 hover:border-[var(--accent)]"
    >
      <div className="flex items-center gap-3">
        {page.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.icon}
            alt=""
            className="h-10 w-10 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] object-contain p-1"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)]">
            📦
          </div>
        )}
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-[var(--fg)] group-hover:text-[var(--accent)]">
            {page.title}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {categoryLabel(page.category)} · {page.createdAt.slice(0, 10)}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-[var(--muted)]">{page.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {page.tags.slice(0, 4).map((t) => (
          <span
            key={t}
            className="rounded-[var(--radius)] border border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)]"
          >
            #{t}
          </span>
        ))}
      </div>
    </Link>
  );
}
