"use client";

/** 图表 iframe 容器：加载期间显示骨架底色，onLoad 后淡入，避免白块 */
import { useState } from "react";

export default function DiagramFrame({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative h-[600px]">
      {!loaded && (
        <div aria-hidden className="iframe-skeleton absolute inset-0" />
      )}
      <iframe
        src={src}
        title={title}
        loading="lazy"
        sandbox="allow-scripts"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full border-0 bg-white transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}
