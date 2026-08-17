// GPT-4.1 mini vs Claude Sonnet 5 — 같은 전사본, 같은 프롬프트로 비교
//
// 사용법:
//   node scripts/compare-models.mjs <전사본.txt> [주제]
//
// study-slack-app/.env 에 OPENAI_API_KEY 와 ANTHROPIC_API_KEY 가 모두 있어야 합니다.
// 결과는 comparison-<파일명>.md 로 저장됩니다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractNamesFromSpeaking,
  extractSpeakerLines,
  computeSpeakingStats,
  buildTranscriptInput,
  buildInsightsPrompt,
  buildEnglishPromptForOne,
  buildCommonFeedbackPrompt,
} from "../study-slack-app/src/prompts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- env ----
function loadEnv() {
  const envPath = path.join(__dirname, "..", "study-slack-app", ".env");
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

// ---- providers ----
// 가격: USD per 1M tokens (2026-08 기준. Sonnet 5는 8/31까지 인트로 $2/$10, 이후 $3/$15)
const PROVIDERS = {
  "gpt-4.1-mini": {
    price: { input: 0.4, output: 1.6 },
    async call(env, content, maxTokens) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [{ role: "user", content }],
          max_completion_tokens: maxTokens,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `OpenAI ${res.status}`);
      return {
        text: data.choices?.[0]?.message?.content?.trim() || "",
        finishReason: data.choices?.[0]?.finish_reason || null,
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      };
    },
  },
  "claude-sonnet-5": {
    price: { input: 2, output: 10 },
    async call(env, content, maxTokens) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: maxTokens,
          messages: [{ role: "user", content }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || `Anthropic ${res.status}`);
      return {
        text: (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim(),
        finishReason: data.stop_reason || null,
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      };
    },
  },
};

// App.jsx의 generate()와 동일한 파이프라인을 한 provider에 대해 실행
async function runPipeline(providerName, env, transcript, verifiedTranscript, topic, names) {
  const provider = PROVIDERS[providerName];
  const usage = { inputTokens: 0, outputTokens: 0, ms: 0, calls: 0 };
  const blocks = {};

  const timed = async (content, maxTokens) => {
    const t0 = Date.now();
    const r = await provider.call(env, content, maxTokens);
    usage.ms += Date.now() - t0;
    usage.calls += 1;
    usage.inputTokens += r.inputTokens;
    usage.outputTokens += r.outputTokens;
    return r;
  };

  console.log(`  [${providerName}] 인사이트...`);
  blocks.insights = await timed(buildInsightsPrompt(verifiedTranscript, topic), 4000);

  blocks.english = [];
  for (const name of names) {
    console.log(`  [${providerName}] 영어 교정: ${name}`);
    const lines = extractSpeakerLines(transcript, name);
    blocks.english.push({ name, ...(await timed(buildEnglishPromptForOne(name, lines), 8192)) });
  }

  console.log(`  [${providerName}] 공통 표현...`);
  blocks.common = await timed(buildCommonFeedbackPrompt(verifiedTranscript), 8192);

  usage.cost =
    (usage.inputTokens * provider.price.input + usage.outputTokens * provider.price.output) / 1e6;
  return { blocks, usage };
}

async function main() {
  const [, , transcriptPath, topicArg] = process.argv;
  if (!transcriptPath) {
    console.error("사용법: node scripts/compare-models.mjs <전사본.txt> [주제]");
    process.exit(1);
  }
  const env = loadEnv();
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    if (!env[key]) {
      console.error(`study-slack-app/.env 에 ${key} 가 비어있습니다.`);
      process.exit(1);
    }
  }

  const transcript = fs.readFileSync(transcriptPath, "utf-8");
  const topic = topicArg || "주식 스터디";
  const fileBytes = fs.statSync(transcriptPath).size;
  const stats = {
    verified: true,
    fileName: path.basename(transcriptPath),
    fileBytes,
    loadedBytes: fileBytes,
    charsRaw: transcript.length,
    wordsRaw: transcript.split(/\s+/).filter(Boolean).length,
  };
  const verifiedTranscript = buildTranscriptInput(transcript, stats);
  const speakingText = computeSpeakingStats(transcript);
  const names = extractNamesFromSpeaking(speakingText);
  console.log(`전사본: ${stats.fileName} (${stats.wordsRaw.toLocaleString()}단어) · 참가자: ${names.join(", ") || "(없음)"}\n`);

  // 두 provider를 병렬로 실행 (provider 내부는 앱과 동일하게 순차)
  const providerNames = Object.keys(PROVIDERS);
  const results = await Promise.all(
    providerNames.map((p) => runPipeline(p, env, transcript, verifiedTranscript, topic, names)),
  );

  // ---- markdown 출력 ----
  const [a, b] = providerNames;
  const [ra, rb] = results;
  const section = (title, contentA, contentB) =>
    [
      `## ${title}`,
      "",
      `### ${a}`,
      "",
      contentA,
      "",
      `### ${b}`,
      "",
      contentB,
      "",
      "---",
      "",
    ].join("\n");

  const fmtUsage = (u) =>
    `호출 ${u.calls}회 · input ${u.inputTokens.toLocaleString()} / output ${u.outputTokens.toLocaleString()} tokens · 합산 응답시간 ${(u.ms / 1000).toFixed(1)}s · 비용 $${u.cost.toFixed(4)}`;

  let md = [
    `# 모델 비교: ${a} vs ${b}`,
    "",
    `- 전사본: ${stats.fileName} (${stats.wordsRaw.toLocaleString()}단어)`,
    `- 주제: ${topic}`,
    `- 일시: ${new Date().toLocaleString("ko-KR")}`,
    "",
    "| | " + a + " | " + b + " |",
    "|---|---|---|",
    `| 요약 | ${fmtUsage(ra.usage)} | ${fmtUsage(rb.usage)} |`,
    "",
    "---",
    "",
  ].join("\n");

  md += section("📈 인사이트", ra.blocks.insights.text, rb.blocks.insights.text);
  for (let i = 0; i < names.length; i++) {
    md += section(
      `🗣️ 영어 교정 — ${names[i]}`,
      ra.blocks.english[i]?.text || "(없음)",
      rb.blocks.english[i]?.text || "(없음)",
    );
  }
  md += section("💬 공통 표현", ra.blocks.common.text, rb.blocks.common.text);

  const outPath = `comparison-${path.basename(transcriptPath, ".txt")}.md`;
  fs.writeFileSync(outPath, md);
  console.log(`\n✅ 저장: ${outPath}`);
  console.log(`   ${a}: ${fmtUsage(ra.usage)}`);
  console.log(`   ${b}: ${fmtUsage(rb.usage)}`);
}

main().catch((e) => {
  console.error("실패:", e.message);
  process.exit(1);
});
