const DEFAULT_FALLBACK_MODELS = ["gemini-2.0-flash-lite", "gemini-2.5-flash"];
const RETRY_DELAYS_MS = [700, 1600];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getModelList() {
  const primaryModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const configuredFallbacks = (process.env.GEMINI_FALLBACK_MODELS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [...new Set([primaryModel, ...configuredFallbacks, ...DEFAULT_FALLBACK_MODELS])];
}

function getApiErrorMessage({ data, response }) {
  if (data?.error?.message) return data.error.message;
  if (typeof data?.error === "string") return data.error;
  if (data?.message) return data.message;
  if (response.statusText) return response.statusText;
  return `Gemini API request failed with status ${response.status}`;
}

async function generateWithModel({ geminiKey, geminiModel, content, maxOutputTokens }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: content }] }],
      generationConfig: { maxOutputTokens },
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage = getApiErrorMessage({ data, response });
    const isQuotaError = apiMessage.includes("Quota exceeded");
    const isHighDemandError =
      response.status === 503 ||
      apiMessage.includes("high demand") ||
      apiMessage.includes("try again later");
    const error = new Error(apiMessage);
    error.statusCode = isQuotaError ? 429 : response.status;
    error.isRetryable = isQuotaError || isHighDemandError;
    throw error;
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModels = getModelList();
  if (!geminiKey) {
    return res.status(500).json({ ok: false, error: "GEMINI_API_KEY environment variable is missing" });
  }

  const { content, maxTokens } = req.body || {};
  const maxOutputTokens = Math.min(Number(maxTokens) || 1024, 4096);
  if (!content) {
    return res.status(400).json({ ok: false, error: "content is required" });
  }

  const failedModels = [];
  try {
    for (const geminiModel of geminiModels) {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          const text = await generateWithModel({ geminiKey, geminiModel, content, maxOutputTokens });
          return res.status(200).json({ ok: true, model: geminiModel, text });
        } catch (e) {
          if (!e.isRetryable) throw e;
          if (attempt < RETRY_DELAYS_MS.length && e.statusCode !== 429) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          failedModels.push(`${geminiModel} (${e.statusCode || "error"})`);
          break;
        }
      }
    }

    res.status(503).json({
      ok: false,
      error: `Gemini is unavailable or quota-limited for all tried models: ${failedModels.join(", ")}. Try again later, reduce transcript size, or use a different Google project API key.`,
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ ok: false, error: e.message || "Gemini API request failed" });
  }
}
