"""量化对比两个视频的画面丰富度：信息熵 / 边缘密度 / 色阶数 / 明暗分布"""
import sys, math, os
from PIL import Image, ImageFilter

def analyze(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    small = im.resize((320, 180))
    px = list(small.getdata())

    # 1) 信息熵（灰度分布）
    gray = small.convert("L")
    gpx = list(gray.getdata())
    hist = [0] * 256
    for v in gpx:
        hist[v] += 1
    total = len(gpx)
    entropy = -sum((c / total) * math.log2(c / total) for c in hist if c)

    # 2) 边缘密度（内容复杂度）
    edges = gray.filter(ImageFilter.FIND_EDGES)
    epx = list(edges.getdata())
    edge_mean = sum(epx) / len(epx)
    edge_ratio = sum(1 for v in epx if v > 40) / len(epx)

    # 3) 色彩丰富度：量化到 4x4x4 = 64 桶
    buckets = set()
    for r, g, b in px:
        buckets.add((r >> 6, g >> 6, b >> 6))

    # 4) 明暗：平均亮度 + 亮部占比
    mean_lum = sum(gpx) / len(gpx)
    bright = sum(1 for v in gpx if v > 200) / len(gpx)

    return {
        "size": f"{w}x{h}",
        "entropy": round(entropy, 2),
        "edge_mean": round(edge_mean, 1),
        "edge_ratio": round(edge_ratio * 100, 1),
        "colors": len(buckets),
        "mean_lum": round(mean_lum),
        "bright_pct": round(bright * 100, 1),
    }

pairs = [(5,), (15,), (26,), (37,), (48,), (59,)]
print(f"{'t':>4} | {'引擎':<11} | {'熵':>5} | {'边缘强度':>6} | {'边缘占比%':>7} | {'色块数':>4} | {'亮度':>4} | {'亮部%':>5}")
print("-" * 78)
for (t,) in pairs:
    for eng, prefix in (("Remotion", "rem"), ("HyperFrames", "hf")):
        p = f"ab-test/frames/{prefix}-{t}s.png"
        if not os.path.exists(p):
            continue
        a = analyze(p)
        print(f"{t:>4} | {eng:<11} | {a['entropy']:>5} | {a['edge_mean']:>6} | {a['edge_ratio']:>7} | {a['colors']:>4} | {a['mean_lum']:>4} | {a['bright_pct']:>5}")
    print("-" * 78)