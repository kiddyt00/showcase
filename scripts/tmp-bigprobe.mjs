const KEY = "3988729267494175a03da3d32f7ed6ad.vjSbYbJCkxsOTfv7";
const BASE = "https://api.z.ai/api/coding/paas/v4";

// 模拟真实分析任务：要求输出大 JSON（sections 5 段 x 400 字）
const prompt = `你是内容分析引擎。基于以下素材写一篇结构化文章，只输出一个 JSON 对象。
素材：英伟达 Q3 财报，营收 570 亿美元同比增 62%，净利润 319 亿，数据中心 512 亿，毛利率 73.4%，Blackwell 售罄，Q4 指引 650 亿。

输出 schema：
{"slug":"nvidia-q3","title":"标题","summary":"摘要","category":"news","tags":["标签"],"sections":[{"heading":"结论式标题","body":"400字以上正文"}],"metadata":{}}

要求：sections 至少 5 个，每段正文 400 字以上。不要 markdown 围栏。`;

async function run(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(600000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      return `${model}: HTTP ${res.status} (${ms}ms) ${(await res.text()).slice(0, 150)}`;
    }
    const d = await res.json();
    const m = d.choices?.[0]?.message ?? {};
    const content = m.content || "";
    const reasoning = m.reasoning_content || "";
    const total = content.length + reasoning.length;
    let parsedOk = "n/a";
    try { JSON.parse(content); parsedOk = "yes"; } catch { parsedOk = "no"; }
    return `${model}: ${ms}ms | content=${content.length} reasoning=${reasoning.length} total=${total} | jsonValid=${parsedOk} | finish=${d.choices?.[0]?.finish_reason}`;
  } catch (e) {
    return `${model}: FAIL (${Date.now() - t0}ms) ${e.message}`;
  }
}

for (const m of process.argv.slice(2)) console.log(await run(m));
