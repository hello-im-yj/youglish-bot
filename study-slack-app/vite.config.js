import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_FALLBACK_MODELS = ["gemini-2.0-flash-lite", "gemini-2.5-flash"];
const RETRY_DELAYS_MS = [700, 1600];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(rawBody || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getModelList(env) {
  const primaryModel = env.GEMINI_MODEL || "gemini-2.0-flash";
  const configuredFallbacks = (env.GEMINI_FALLBACK_MODELS || "")
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

function localApi(env) {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api/gemini", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        const geminiKey = env.GEMINI_API_KEY;
        const geminiModels = getModelList(env);
        if (!geminiKey) {
          sendJson(res, 500, { ok: false, error: "GEMINI_API_KEY environment variable is missing" });
          return;
        }

        try {
          const { content, maxTokens } = await readJsonBody(req);
          const maxOutputTokens = Math.min(Number(maxTokens) || 1024, 4096);
          const failedModels = [];

          for (const geminiModel of geminiModels) {
            for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
              try {
                const text = await generateWithModel({ geminiKey, geminiModel, content, maxOutputTokens });
                sendJson(res, 200, { ok: true, model: geminiModel, text });
                return;
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

          sendJson(res, 503, {
            ok: false,
            error: `Gemini is unavailable or quota-limited for all tried models: ${failedModels.join(", ")}. Try again later, reduce transcript size, or use a different Google project API key.`,
          });
        } catch (e) {
          sendJson(res, e.statusCode || 500, { ok: false, error: e.message });
        }
      });

      server.middlewares.use("/api/send-slack", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        try {
          const webhookUrl = env.SLACK_WEBHOOK_URL;
          if (!webhookUrl) {
            sendJson(res, 500, { ok: false, error: "SLACK_WEBHOOK_URL environment variable is missing" });
            return;
          }

          const { text, payload } = await readJsonBody(req);
          const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || { text }),
          });

          if (!response.ok) throw new Error("Slack error");
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e.message });
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), localApi(env)],
  };
});
