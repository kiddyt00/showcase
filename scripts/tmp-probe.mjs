const KEY = "3988729267494175a03da3d32f7ed6ad.vjSbYbJCkxsOTfv7";
const BASE = "https://api.z.ai/api/coding/paas/v4";

async function probe(model) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "用一句话说明什么是数据库事务" }],
        max_tokens: 100,
      }),
      signal: AbortSignal.timeout(120000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text();
      return `${model}: HTTP ${res.status} (${ms}ms) ${txt.slice(0, 120)}`;
    }
    const d = await res.json();
    const m = d.choices?.[0]?.message ?? {};
    const len = (m.content || "").length + (m.reasoning_content || "").length;
    return `${model}: OK (${ms}ms) content_len=${len} head=${(m.content || m.reasoning_content || "").slice(0, 50)}`;
  } catch (e) {
    return `${model}: FAIL (${Date.now() - t0}ms) ${e.message}`;
  }
}

const models = process.argv.slice(2);
for (const m of models) {
  console.log(await probe(m));
}
