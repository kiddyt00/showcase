"use client";

/** 报头日期：客户端渲染（服务端 new Date() 会阻断 not-found 等页的静态预渲染） */
import { useEffect, useState } from "react";

export default function MastheadDate() {
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      })
    );
  }, []);

  // 首帧占位固定字符串，避免水合不一致
  return <p className="text-xs text-muted">{today || "\u00A0"}</p>;
}
