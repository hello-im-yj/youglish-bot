const DEFAULT_FALLBACK_MODELS = ["gpt-4o-mini"];
const RETRY_DELAYS_MS = [700, 1600];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModelList() {
  const primaryModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const configuredFallbacks = (process.env.OPENAI_FALLBACK_MODELS || "")
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
  return `OpenAI API request failed with status ${response.status}`;
}

async function generateWithModel({ openaiKey, model, content, maxOutputTokens }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      max_completion_tokens: maxOutputTokens,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = getApiErrorMessage({ data, response });
    const isQuotaError = response.status === 429;
    const isHighDemandError = response.status === 503 || apiMessage.includes("overloaded");
    const error = new Error(apiMessage);
    error.statusCode = response.status;
    error.isRetryable = isQuotaError || isHighDemandError;
    throw error;
  }

  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim() || "";
  const finishReason = choice?.finish_reason || null;
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

  const openaiKey = process.env.OPENAI_API_KEY;
  const models = getModelList();
  if (!openaiKey) {
    return res.status(500).json({ ok: false, error: "OPENAI_API_KEY environment variable is missing" });
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
          const { text, finishReason } = await generateWithModel({ openaiKey, model, content, maxOutputTokens });
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
      error: `OpenAI is unavailable or quota-limited for all tried models: ${failedModels.join(", ")}. Try again later.`,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, error: e.message || "OpenAI API request failed" });
  }
}
