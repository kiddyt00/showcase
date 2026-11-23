import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center">
      <p className="text-6xl font-bold text-emerald-400">404</p>
      <h1 className="mt-4 text-2xl font-bold text-zinc-100">页面不存在</h1>
      <p className="mt-2 text-sm text-zinc-500">
        它可能已被删除，或者从未存在过。
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400"
      >
        回到首页
      </Link>
    </div>
  );
}
