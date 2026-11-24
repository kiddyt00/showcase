"use client";

/**
 * FlowDiagram：交互式架构/流程图组件
 * 与视频 StepFlow 动画共享同一视觉语言（节点卡片 + 连线 + 逐节点点亮）。
 * 数据源：Diagram.spec（SeeCode graph 规范：nodes[{id,label,sub?,row,col}] + edges[[from,to,label?,kind?]]）
 * 交互：hover 节点高亮关联连线；点击节点展开详情；入场逐节点点亮（IntersectionObserver）
 */
import { useEffect, useMemo, useRef, useState } from "react";

interface SpecNode {
  id: string;
  label: string;
  sub?: string;
  tag?: string;
  kind?: string;
  row: number;
  col: number;
  focal?: boolean;
}
interface SpecEdge {
  from: string;
  to: string;
  label?: string;
  kind?: string;
}
interface FlowSpec {
  nodes: SpecNode[];
  edges: (SpecEdge | [string, string] | [string, string, string] | [string, string, string, string])[];
  title?: string;
}

const NODE_W = 168;
const NODE_H = 72;
const COL_GAP = 90;
const ROW_GAP = 64;
const PADDING = 24;

const ACCENT = "var(--accent)";
const ACCENT_DIM = "color-mix(in srgb, var(--accent) 35%, transparent)";

export default function FlowDiagram({ spec }: { spec: unknown; dark?: boolean }) {
  const parsed = useMemo<FlowSpec | null>(() => {
    try {
      const s = spec as FlowSpec;
      if (!s || !Array.isArray(s.nodes) || !s.nodes.length || !Array.isArray(s.edges)) return null;
      return s;
    } catch {
      return null;
    }
  }, [spec]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 滚动进入视口后触发入场点亮
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!parsed) return null;

  const { nodes, edges } = parsed;
  const normEdges: SpecEdge[] = edges.map((e) =>
    Array.isArray(e) ? { from: e[0], to: e[1], label: e[2], kind: e[3] } : e
  );

  // 网格坐标 → 像素
  const maxRow = Math.max(...nodes.map((n) => n.row), 0);
  const maxCol = Math.max(...nodes.map((n) => n.col), 0);
  const width = PADDING * 2 + (maxCol + 1) * (NODE_W + COL_GAP);
  const height = PADDING * 2 + (maxRow + 1) * (NODE_H + ROW_GAP);
  const pos = (n: SpecNode) => ({
    x: PADDING + n.col * (NODE_W + COL_GAP) + NODE_W / 2,
    y: PADDING + n.row * (NODE_H + ROW_GAP) + NODE_H / 2,
  });
  const nodeById = (id: string) => nodes.find((n) => n.id === id);

  // hover/选中节点的关联连线集合
  const related = useMemo(() => {
    const focus = hoverId ?? selectedId;
    if (!focus) return null;
    return new Set(
      normEdges
        .filter((e) => e.from === focus || e.to === focus)
        .map((_, i) => i)
    );
  }, [hoverId, selectedId, normEdges]);

  const selected = selectedId ? nodeById(selectedId) : null;
  const selectedEdges =
    selectedId ? normEdges.filter((e) => e.from === selectedId || e.to === selectedId) : [];

  // 线段坐标：从 from 边缘到 to 边缘
  function edgePath(e: SpecEdge): { d: string; mid: { x: number; y: number } } {
    const a = nodeById(e.from);
    const b = nodeById(e.to);
    if (!a || !b) return { d: "", mid: { x: 0, y: 0 } };
    const pa = pos(a);
    const pb = pos(b);
    // 若同行从左右两侧连；不同行走中心到中心的折线（水平优先）
    const sameRow = a.row === b.row;
    let d: string;
    if (sameRow) {
      const dir = pb.x > pa.x ? 1 : -1;
      const x1 = pa.x + (dir * NODE_W) / 2;
      const x2 = pb.x - (dir * NODE_W) / 2;
      d = `M ${x1} ${pa.y} L ${x2} ${pb.y}`;
    } else {
      const dx = pb.x - pa.x;
      const midX = pa.x + dx / 2;
      d = `M ${pa.x} ${pa.y} L ${midX} ${pa.y} L ${midX} ${pb.y} L ${pb.x} ${pb.y}`;
    }
    return { d, mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 } };
  }

  const lineColor = (e: SpecEdge, i: number) => {
    if (related && !related.has(i)) return "var(--border)";
    if (e.kind === "async") return "var(--muted)";
    if (e.kind === "primary" || hoverId || selectedId) return ACCENT;
    return "color-mix(in srgb, var(--fg) 40%, transparent)";
  };

  return (
    <div ref={containerRef} className="my-2">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
        <div style={{ position: "relative", width, height, minWidth: "100%" }}>
          {/* 连线层 */}
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            {normEdges.map((e, i) => {
              const { d, mid } = edgePath(e);
              if (!d) return null;
              const active = related?.has(i) ?? true;
              // 入场：连线在两端节点出现后生长
              const fromIdx = nodes.findIndex((n) => n.id === e.from);
              const delay = 300 + fromIdx * 260;
              return (
                <g key={i} opacity={inView ? 1 : 0} style={{ transition: "opacity 400ms" }}>
                  <path
                    d={d}
                    fill="none"
                    stroke={lineColor(e, i)}
                    strokeWidth={active ? 2 : 1.5}
                    strokeDasharray={e.kind === "async" ? "6 4" : undefined}
                    style={{
                      transition: "stroke 200ms",
                      strokeDashoffset: inView ? 0 : 400,
                      ...(inView
                        ? {}
                        : {}),
                    }}
                  />
                  {e.label ? (
                    <text
                      x={mid.x}
                      y={mid.y - 6}
                      textAnchor="middle"
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                        fill: active ? "var(--fg)" : "var(--muted)",
                        opacity: inView ? 1 : 0,
                        transition: "opacity 400ms",
                      }}
                    >
                      {e.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/* 节点层 */}
          {nodes.map((n, i) => {
            const p = pos(n);
            const isFocus = hoverId === n.id || selectedId === n.id;
            const dimmed = (hoverId || selectedId) && !isFocus && !relatedEdgesOf(n, normEdges, hoverId ?? selectedId);
            const appeared = inView; // 入场由 IntersectionObserver 触发，逐个 stagger
            return (
              <div
                key={n.id}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => setSelectedId(selectedId === n.id ? null : n.id)}
                style={{
                  position: "absolute",
                  left: p.x - NODE_W / 2,
                  top: p.y - NODE_H / 2,
                  width: NODE_W,
                  height: NODE_H,
                  opacity: appeared ? 1 : 0,
                  transform: appeared
                    ? dimmed
                      ? "scale(0.96)"
                      : "scale(1)"
                    : "translateY(14px) scale(0.95)",
                  transition: `opacity 500ms ${i * 260}ms, transform 500ms ${i * 260}ms, box-shadow 200ms, border-color 200ms`,
                  border: `1.5px solid ${isFocus ? ACCENT : "var(--border)"}`,
                  borderRadius: 10,
                  background: "var(--card)",
                  boxShadow: isFocus ? `0 0 20px ${ACCENT_DIM}` : "none",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  padding: "8px 10px",
                  textAlign: "center",
                            }}
              >
                {n.tag ? (
                  <span
                    style={{
                      position: "absolute",
                      top: -9,
                      right: -6,
                      fontSize: 10,
                      fontFamily: "ui-monospace, monospace",
                      background: "var(--bg)",
                      color: ACCENT,
                      border: `1px solid ${ACCENT_DIM}`,
                      borderRadius: 4,
                      padding: "1px 6px",
                    }}
                  >
                    {n.tag}
                  </span>
                ) : null}
                <span
                  style={{
                    fontSize: n.sub ? 14 : 15,
                    fontWeight: n.focal ? 700 : 600,
                    color: isFocus ? ACCENT : "var(--fg)",
                    lineHeight: 1.2,
                  }}
                >
                  {n.label}
                </span>
                {n.sub ? (
                  <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.2 }}>{n.sub}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* 点击节点的详情面板 */}
      {selected ? (
        <div
          className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 py-3"
          style={{ borderColor: ACCENT_DIM }}
        >
          <p className="text-sm font-semibold" style={{ color: ACCENT }}>
            {selected.label}
            {selected.sub ? <span className="ml-2 text-xs font-normal text-muted">{selected.sub}</span> : null}
          </p>
          {selectedEdges.length ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted">
              {selectedEdges.map((e, i) => (
                <li key={i}>
                  {e.from === selectedId ? "→ " : "← "}
                  <span className="text-[var(--fg)]">{nodeById(e.from === selectedId ? e.to : e.from)?.label}</span>
                  {e.label ? <span className="ml-1 font-mono">（{e.label}）</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            onClick={() => setSelectedId(null)}
            className="mt-2 text-xs text-muted underline hover:text-accent"
          >
            收起
          </button>
        </div>
      ) : (
        <p className="mt-1 text-right text-[11px] text-muted">
          悬停高亮关联链路 · 点击节点查看详情
        </p>
      )}
    </div>
  );
}

/** 节点是否与焦点节点有直接连线（用于 hover 时弱化无关节点） */
function relatedEdgesOf(node: SpecNode, edges: SpecEdge[], focusId: string | null): boolean {
  if (!focusId) return false;
  return edges.some(
    (e) => (e.from === focusId && e.to === node.id) || (e.to === focusId && e.from === node.id)
  );
}
