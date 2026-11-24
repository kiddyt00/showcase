import type { MetadataRoute } from "next";
import { listPageSummaries } from "@showcase/core/store";



export default async function sitemap(): Promise<MetadataRoute.Sitemap> {

  const base = process.env.SITE_URL || "http://localhost:3000";
  const pages = listPageSummaries(500);
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/weekly`, changeFrequency: "weekly", priority: 0.9 },
    ...pages.map((p) => ({
      url: `${base}/show/${p.slug}`,
      lastModified: new Date(p.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
