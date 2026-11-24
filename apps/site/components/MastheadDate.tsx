"use client";

/** 报头日期：客户端渲染（服务端 new Date() 会阻断 not-found 等页的静态预渲染） */
import { useEffect, useState } from "react";
import Link from "next/link";

export default function MastheadDate() {
  const [today, setToday] = useState("");
  const [isFriday, setIsFriday] = useState(false);

  useEffect(() => {
    const now = new Date();
    setToday(
      now.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      })
    );
    // 周五出刊日：日期后追加「今日出刊」链接（当日仅此一处提示，其他天不显示）
    setIsFriday(now.getDay() === 5);
  }, []);

  // 首帧占位固定字符串，避免水合不一致
  return (
    <p className="text-xs text-muted">
      {today || "\u00A0"}
      {isFriday ? (
        <>
          {" · "}
          <Link href="/weekly" className="link-editorial font-medium text-accent hover:text-accent">
            今日出刊 →
          </Link>
        </>
      ) : null}
    </p>
  );
}
