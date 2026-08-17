const DEFAULT_FALLBACK_MODELS = ["claude-haiku-4-5"];
const RETRY_DELAYS_MS = [700, 1600];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModelList() {
  const primaryModel = (process.env.ANTHROPIC_MODEL || "").trim() || "claude-sonnet-5";
  const configuredFallbacks = (process.env.ANTHROPIC_FALLBACK_MODELS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primaryModel, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS])];
}

function getApiErrorMessage({ data, response }) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === "string") return data.error;
  if (data?.message) return data.message;
  if (response.statusText) return response.statusText;
  return `Claude API request failed with status ${response.status}`;
}

async function generateWithModel({ apiKey, model, content, maxOutputTokens }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      messages: [{ role: "user", content }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = getApiErrorMessage({ data, response });
    const isRateLimited = response.status === 429;
    const isOverloaded = response.status === 529 || response.status >= 500;
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    error.isRetryable = isRateLimited || isOverloaded;
    throw error;
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const finishReason = data.stop_reason || null;
  return { text, finishReason };
}

function isAllowedOrigin(req) {
  const allowedOrigin = process.env.APP_ORIGIN;
  if (!allowedOrigin) return true;
  const origin = req.headers.origin || req.headers.referer || "";
  return origin.startsWith(allowedOrigin);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!isAllowedOrigin(req)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const models = getModelList();
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "ANTHROPIC_API_KEY environment variable is missing" });
  }

  const { content, maxTokens } = req.body || {};
  const maxOutputTokens = Math.min(Number(maxTokens) || 1024, 16000);
  if (!content) {
    return res.status(400).json({ ok: false, error: "content is required" });
  }

  const failedModels = [];
  try {
    for (const model of models) {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          const { text, finishReason } = await generateWithModel({ apiKey, model, content, maxOutputTokens });
          return res.status(200).json({ ok: true, model, text, finishReason });
        } catch (e) {
          if (!e.isRetryable) throw e;
          if (attempt < RETRY_DELAYS_MS.length && e.statusCode !== 429) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          failedModels.push(`${model} (${e.statusCode || "error"})`);
          break;
        }
      }
    }

    res.status(503).json({
      ok: false,
      error: `Claude API is unavailable or rate-limited for all tried models: ${failedModels.join(", ")}. Try again later.`,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, error: e.message || "Claude API request failed" });
  }
}
