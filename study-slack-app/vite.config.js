import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_FALLBACK_MODELS = ["claude-haiku-4-5"];
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
  const primaryModel = (env.ANTHROPIC_MODEL || "").trim() || "claude-sonnet-5";
  const configuredFallbacks = (env.ANTHROPIC_FALLBACK_MODELS || "")
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

function localApi(env) {
  return {
    name: "local-api",
    configureServer(server) {
      server.middlewares.use("/api/claude", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }

        const apiKey = env.ANTHROPIC_API_KEY;
        const models = getModelList(env);
        if (!apiKey) {
          sendJson(res, 500, { ok: false, error: "ANTHROPIC_API_KEY environment variable is missing" });
          return;
        }

        try {
          const { content, maxTokens } = await readJsonBody(req);
          const maxOutputTokens = Math.min(Number(maxTokens) || 1024, 16000);
          if (!content) {
            sendJson(res, 400, { ok: false, error: "content is required" });
            return;
          }
          const failedModels = [];

          for (const model of models) {
            for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
              try {
                const { text, finishReason } = await generateWithModel({ apiKey, model, content, maxOutputTokens });
                sendJson(res, 200, { ok: true, model, text, finishReason });
                return;
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

          sendJson(res, 503, {
            ok: false,
            error: `Claude API is unavailable or rate-limited for all tried models: ${failedModels.join(", ")}. Try again later.`,
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
