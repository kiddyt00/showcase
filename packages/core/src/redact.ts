/**
 * 敏感信息扫描器
 * 在内容发布前扫描正文，命中敏感模式则替换为占位符。
 * 覆盖：API key、JWT、私钥块、云厂商凭证、IP/内网地址、连接串、邮箱、手机号。
 */
const RULES: {
  name: string;
  pattern: RegExp;
  replacement: string | ((m: string, p1?: string) => string);
}[] = [
  { name: "OpenAI 风格 API Key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "DeepSeek API Key", pattern: /\bds-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "Google API Key", pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { name: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED_AWS_KEY]" },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: "[REDACTED_JWT]" },
  { name: "私钥块", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: "[REDACTED_PRIVATE_KEY]" },
  { name: "GitHub Token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, replacement: "[REDACTED_GH_TOKEN]" },
  { name: "Slack Token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{15,}\b/g, replacement: "[REDACTED_TOKEN]" },
  { name: "数据库连接串", pattern: /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s"']{10,}\b/gi, replacement: "[REDACTED_CONNECTION_STRING]" },
  { name: "Bearer 凭证", pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi, replacement: "Bearer [REDACTED]" },
  { name: "通用赋值型密钥", pattern: /\b(api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*["']?[^"'\s]{12,}["']?/gi, replacement: (_m: string, p1?: string) => `${p1 ?? ""}=[REDACTED]` },
  { name: "IPv4 内网地址", pattern: /\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED_INTERNAL_IP]" },
  { name: "公网 IP", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[REDACTED_IP]" },
  { name: "邮箱", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[REDACTED_EMAIL]" },
  { name: "手机号", pattern: /\b1[3-9]\d{9}\b/g, replacement: "[REDACTED_PHONE]" },
  { name: "内网域名", pattern: /\b[\w.-]+\.(?:internal|local|lan|corp|intranet)\b/gi, replacement: "[REDACTED_INTERNAL_HOST]" },
];

export interface ScanResult {
  /** 清洗后的文本 */
  cleaned: string;
  /** 命中的规则统计 */
  hits: Record<string, number>;
  /** 是否有任何命中 */
  changed: boolean;
}

/** 扫描并清洗一段文本 */
export function scanAndRedact(text: string): ScanResult {
  const hits: Record<string, number> = {};
  let cleaned = text;
  for (const rule of RULES) {
    const replacement: string | ((m: string, p1?: string) => string) = rule.replacement;
    cleaned = cleaned.replace(rule.pattern, (match: string, p1?: string) => {
      // 保留文档型占位符（示例值通常是 placeholder，不脱敏常见假值）
      if (/your[-_]?|example|xxx|<[^>]+>|\$\{/i.test(match)) return match;
      hits[rule.name] = (hits[rule.name] ?? 0) + 1;
      return typeof replacement === "function" ? replacement(match, p1) : replacement;
    });
  }
  return { cleaned, hits, changed: Object.keys(hits).length > 0 };
}

/** 清洗整个 PageContent 的正文部分（发布前调用） */
/** 清洗整个 PageContent（发布前调用）：深拷贝后清洗，返回新对象，不修改入参 */
export function redactPageContent<
  T extends {
    title: string;
    summary: string;
    tags?: string[];
    metadata?: Record<string, string | number | undefined> | null;
    sections: { body: string; bullets?: string[]; code?: { content: string } }[];
  }
>(
  page: T
): { page: T; hits: Record<string, number> } {
  const allHits: Record<string, number> = {};
  const bump = (hits: Record<string, number>) => {
    for (const [k, v] of Object.entries(hits)) allHits[k] = (allHits[k] ?? 0) + v;
  };

  // 深拷贝：调用方应直接使用返回的新对象
  const next = structuredClone(page);

  const title = scanAndRedact(next.title);
  bump(title.hits);
  next.title = title.cleaned;

  const summary = scanAndRedact(next.summary);
  bump(summary.hits);
  next.summary = summary.cleaned;

  if (next.tags) {
    next.tags = next.tags.map((t) => {
      const r = scanAndRedact(String(t));
      bump(r.hits);
      return r.cleaned;
    });
  }

  if (next.metadata) {
    const metadata: Record<string, string | number | undefined> = {};
    for (const [k, v] of Object.entries(next.metadata)) {
      if (v === undefined) {
        metadata[k] = undefined;
        continue;
      }
      const r = scanAndRedact(String(v));
      bump(r.hits);
      // 原值为数字且未被清洗时保留数字类型，否则按清洗后的字符串回填
      metadata[k] = r.changed || typeof v !== "number" ? r.cleaned : v;
    }
    next.metadata = metadata;
  }

  for (const section of next.sections) {
    const body = scanAndRedact(section.body);
    bump(body.hits);
    section.body = body.cleaned;
    if (section.bullets) {
      section.bullets = section.bullets.map((b) => {
        const r = scanAndRedact(b);
        bump(r.hits);
        return r.cleaned;
      });
    }
    if (section.code?.content) {
      const r = scanAndRedact(section.code.content);
      bump(r.hits);
      section.code.content = r.cleaned;
    }
  }
  return { page: next, hits: allHits };
}
