import { useRef, useState } from "react";

const blockMeta = [
  { key: "insights", icon: "📈", label: "오늘의 주식 스터디 인사이트" },
  { key: "speaking", icon: "🎙️", label: "사용자 발화량 분석" },
  { key: "english", icon: "🗣️", label: "영어 표현 교정 꿀팁" },
  { key: "common", icon: "💬", label: "이번 스터디 공통 표현 개선 포인트" },
];

function extractNamesFromSpeaking(text) {
  const names = [];
  for (const line of text.split("\n")) {
    const stripped = line.replace(/^[\s•\-*]+/, "").trim();
    const m = stripped.match(/^([가-힣a-zA-Z][가-힣a-zA-Z\s]{0,15}?)\s*[:：]/);
    if (m) {
      const name = m[1].trim();
      if (name.length >= 2 && !/^(http|www|참석|발화|분석|note|오류|error|api|🎙)/i.test(name)) {
        names.push(name);
      }
    }
  }
  return [...new Set(names)];
}

function extractSpeakerLines(transcript, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:\\[${escaped}\\]|${escaped})\\s*:([^\\n]+)`, "g");
  const lines = [];
  let m;
  while ((m = regex.exec(transcript)) !== null) lines.push(m[1].trim());
  return lines.join("\n");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function computeSpeakingStats(transcript) {
  const counts = {};
  for (const line of transcript.split("\n")) {
    const m = line.match(/^\d+:\d+\s+(.+?):\s(.+)$/);
    if (!m) continue;
    const speaker = m[1].trim();
    const text = m[2].trim();
    const sentences = (text.match(/[.?!]/g) || []).length || 1;
    counts[speaker] = (counts[speaker] || 0) + sentences;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
  const lines = ["🎙️ *사용자 발화량 분석*", ""];
  for (const [name, count] of sorted) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    lines.push(`${name}: 문장 수 ${count}개 · 전체 비중 ${pct}%`);
  }
  return lines.join("\n");
}

function buildTranscriptInput(transcript, stats) {
  const verification = stats?.verified
    ? "전사본 파일 전체 로드 검증 완료"
    : "전사본 파일 전체 로드 검증 미완료";

  return `[전사본 입력 검증]
상태: ${verification}
파일명: ${stats?.fileName || "(알 수 없음)"}
원본 파일 크기: ${formatNumber(stats?.fileBytes)} bytes
앱 로드 크기: ${formatNumber(stats?.loadedBytes)} bytes
문자 수: ${formatNumber(stats?.charsRaw)}
단어 수: ${formatNumber(stats?.wordsRaw)}

[전사본 전체 시작]
${transcript}
[전사본 전체 끝]`;
}

async function callAPI(content, maxTokens) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, maxTokens }),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    const fallback = raw?.slice(0, 300) || res.statusText || "서버 응답을 처리하지 못했습니다.";
    const message = data?.error || fallback;
    throw new Error(`API ${res.status}: ${message}`);
  }

  return { text: data.text || "", model: data.model || "", finishReason: data.finishReason || null };
}

const buildInsightsPrompt = (transcript, topic) => `주식 스터디 전사본을 읽고, 투자 판단에 활용할 수 있는 인사이트를 최대 5개 뽑아주세요.
토론 형식이나 주제가 무엇이든 관계없습니다. 어떤 대화든 투자 시사점으로 연결될 수 있는 내용이면 추출하세요.

[포함 기준 — 하나라도 해당하면 인사이트로 추출]
• 기업·브랜드·제품에 대한 인식 변화 (긍정/부정 모두)
• 소비자 행동·생활 패턴·선호도 변화
• 산업 구조 변화, 시장 성장·축소 신호
• 기술·규제·정책 트렌드
• 경쟁 환경 변화, 신규 플레이어 등장
• 종목·섹터 직접 언급, 실적·전략 관련 내용
• 매크로 지표, 금리·환율·원자재 등 거시 변수
• 일상 속 소비 경험에서 포착되는 시장 신호

[제외] 스터디 일정·운영 공지, 순수 잡담, 인사말

[출력 형식 — 아래 예시처럼 간결하게]
📈 *오늘의 주식 스터디 인사이트* (${topic})

📦 *e-커머스 구매 빈도 증가* → 쿠팡·알리 플랫폼 수혜 지속
💪 *단백질 음료 MZ 소비 확대* → 헬스·건기식 섹터 성장 모멘텀
☕ *스타벅스 불매운동* → 토종 커피·편의점 음료 반사이익 가능성

제목 이모지는 📈를 사용.
각 인사이트 줄은 📈를 반복하지 말고, 내용에 맞는 서로 다른 이모지 1개로 시작.
예: 소비/유통 📦🛒, 식음료 ☕🍔, 헬스 💪, 자동차 🚗, 반도체 🔌, 금융 💳, AI/IT 🤖, 에너지 ⚡, 조선/방산 🚢, 바이오 🧬, 엔터 🎬
형식: 내용별 이모지 + *굵게 핵심 트렌드* → 관련 섹터/종목 시사점 한 줄
딱 이 형식으로만. 부연 설명 없이 결과만 반환. 최대 5개.

전사본:
${transcript}`;


const buildEnglishPromptForOne = (name, speakerLines) => `아래는 영어 스터디에서 ${name}이(가) 발화한 내용이야. 발화를 모두 훑고 기준에 맞는 문장 최대 5개를 골라 피드백해줘.

[문장 선정 기준 — 아래 우선순위대로 적용]
1순위 재사용 가능성: 다음 스터디에서도 비슷한 상황에 바로 다시 쓸 수 있는 표현인가? (질문 꺼내기, 경험 말하기, 의견 제시, 이유 설명, 비교, 상대 의견 반응 등)
2순위 개선 효과: 자연스럽게 바꿨을 때 표현력이 크게 좋아지는가? 단순 관사·단복수 오류만 고치는 문장보다, 표현 자체가 더 자연스러워질 수 있는 문장 우선
3순위 말하기 습관 반영: 이 참가자가 자주 쓰는 한국어식 표현, 반복 패턴, 어색한 구조가 드러나는가?
4순위 의미 명확성: 전사 오류가 있더라도 문맥상 말하려는 의미가 비교적 명확한가?
5순위 주제 관련성: 스터디 주제와 관련 있고 토론 맥락에서 실제로 쓸 만한 문장인가?

가능하면 5문장 안에 아래 유형이 골고루 포함되게 해줘. 단, 억지로 맞추기보다 재사용 가능성과 개선 효과를 우선해줘.
- 질문하는 문장 / 본인 경험을 말하는 문장 / 의견을 말하는 문장 / 이유나 근거를 설명하는 문장 / 비교하거나 상대 의견에 반응하는 문장

[제외]
- Yeah / Okay / Right 등 짧은 반응
- 전사 오류가 심해 의미 파악이 어려운 문장
- 한국어 발화, 자동 안내 메시지, 잘린 발화

[출력 형식 — 이 형식 외 다른 텍스트 없이]
*[${name}]*

*1)* \`원문 문장\`
*Better:* \`원어민이 실제 대화에서 쓸 법한 자연스러운 표현\`
*Feedback:* 한국어로 짧게 — "이 상황엔 이 표현", "다음에도 이 패턴 응용 가능" 위주로

(각 항목 사이 빈 줄 필수, 최대 5개)

*이번 주 표현 포인트*
• 자주 보이는 표현 습관: (한 줄)
• 다음 스터디에서 바로 써볼 표현:
  -
  -
  -

영어 발화가 없으면 "*[${name}]*" 다음 줄에 "(영어 발화 없음)"만 출력.

[피드백 톤] "틀렸다"보다 "이렇게 말하면 더 자연스럽다" 위주. 너무 격식 있는 표현보다 구어체 우선. 전사 오류로 보이는 부분은 문맥상 의미를 합리적으로 추정해 처리.

${name}의 발화:
${speakerLines || "(발화 내용 없음)"}`;

const buildCommonFeedbackPrompt = (transcript) => `아래는 영어 스터디 전사본이야. 참가자 전체 발화를 읽고 공통 표현 피드백을 작성해줘.

[출력 형식 — 이 형식 외 다른 텍스트 없이]
*이번 스터디 공통 표현 개선 포인트*

(전체적으로 보이는 공통 표현 습관을 2~3문장으로 설명. 잘한 점도 한 줄 언급.)

*다음 스터디에서 모두가 써볼 만한 표현 5개*

1. \`영어 표현\`
   한국어 설명 — 어떤 상황에서 쓰면 좋은지 한 줄
2. \`영어 표현\`
   한국어 설명
3. \`영어 표현\`
   한국어 설명
4. \`영어 표현\`
   한국어 설명
5. \`영어 표현\`
   한국어 설명

[작성 기준]
- 추천 표현은 참가자들의 실제 발화 패턴에서 나온 것이어야 함 (일반적인 표현 나열 금지)
- 너무 격식 있거나 어려운 표현보다 다음 스터디에서 바로 써볼 수 있는 구어체 우선
- 톤은 코칭하듯 부드럽게

전사본:
${transcript}`;

function SlackBlock({ meta, content, loading, finishInfo }) {
  const hasMaxTokens = finishInfo && (Array.isArray(finishInfo) ? finishInfo : [finishInfo]).some((f) => f.includes("MAX_TOKENS"));
  const badges = finishInfo ? (Array.isArray(finishInfo) ? finishInfo : [finishInfo]) : [];
  return (
    <div style={{ border: "0.5px solid #e0e0e0", borderRadius: 12, marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 14px",
          background: "#f8f8f8",
          borderBottom: "0.5px solid #e8e8e8",
          borderRadius: "12px 12px 0 0",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "#555" }}>
          {meta.icon} {meta.label}
        </span>
        {badges.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {badges.map((b, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  borderRadius: 4,
                  padding: "1px 6px",
                  background: b.includes("MAX_TOKENS") ? "#fff0f0" : "#f0f7f0",
                  color: b.includes("MAX_TOKENS") ? "#c0392b" : "#2d7a3a",
                }}
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        style={{
          padding: "13px 14px",
          fontSize: 12.5,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: 1.7,
          color: loading ? "#aaa" : "#222",
          minHeight: 48,
        }}
      >
        {loading ? "⏳ 분석 중..." : content || ""}
      </div>
    </div>
  );
}

function getTopic(topicSelect, topicCustom) {
  return topicSelect === "기타"
    ? topicCustom.trim() || "주식 스터디"
    : topicSelect || "주식 스터디";
}

function getDateLabel(studyDate) {
  return studyDate
    ? new Date(`${studyDate}T00:00:00`).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "(미입력)";
}

function buildFullMessage({ results, studyDate, participants, topic }) {
  const header = [
    "─────────────────────",
    `📅 *스터디 일자*: ${getDateLabel(studyDate)}`,
    `👥 *참석자*: ${participants.trim() || "(미입력)"}`,
    `📌 *주제*: ${topic}`,
    "─────────────────────",
  ].join("\n");
  const body = blockMeta.map((m) => results[m.key] || "").join("\n\n");
  return `${header}\n\n${body}`;
}

function buildSlackPayload({ results, studyDate, participants, topic }) {
  const header = [
    `📅 *스터디 일자*: ${getDateLabel(studyDate)}`,
    `👥 *참석자*: ${participants.trim() || "(미입력)"}`,
    `📌 *주제*: ${topic}`,
  ].join("\n");

  return {
    text: `주식 스터디 요약 - ${getDateLabel(studyDate)}`,
    attachments: [
      {
        color: "#4A154B",
        text: header,
        mrkdwn_in: ["text"],
      },
      {
        color: "#2EB67D",
        text: results.insights || "",
        mrkdwn_in: ["text"],
      },
      {
        color: "#36C5F0",
        text: results.speaking || "",
        mrkdwn_in: ["text"],
      },
    ],
  };
}

export default function App() {
  const [fileName, setFileName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [transcriptStats, setTranscriptStats] = useState(null);
  const [studyDate, setStudyDate] = useState("");
  const [participants, setParticipants] = useState("");
  const [topicSelect, setTopicSelect] = useState("");
  const [topicCustom, setTopicCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);
  const [blockLoading, setBlockLoading] = useState({ insights: false, speaking: false, english: false });
  const [englishProgress, setEnglishProgress] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [slackMsg, setSlackMsg] = useState("");
  const [usedModel, setUsedModel] = useState("");
  const [finishReasons, setFinishReasons] = useState({});
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith(".txt")) {
      setError(".txt 파일만 업로드할 수 있어요.");
      return;
    }

    setError("");
    setResults(null);
    setCopyMsg("");
    setSlackMsg("");
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder("utf-8").decode(buffer);
      const loadedBytes = buffer.byteLength;
      const verified = loadedBytes === file.size;
      const wordsRaw = text.split(/\s+/).filter(Boolean).length;

      setTranscript(text);
      setTranscriptStats({
        fileName: file.name,
        fileBytes: file.size,
        loadedBytes,
        verified,
        charsRaw: text.length,
        wordsRaw,
        chars: text.length.toLocaleString(),
        words: wordsRaw.toLocaleString(),
        fileBytesLabel: file.size.toLocaleString(),
        loadedBytesLabel: loadedBytes.toLocaleString(),
      });

      const dateRegex = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/;
      const dm = file.name.match(dateRegex) || text.slice(0, 2000).match(dateRegex);
      if (dm) {
        const [, y, mo, d] = dm;
        setStudyDate(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
      }
      setParticipants("");
      if (!verified) {
        setError("전사본 로드 검증 실패: 원본 파일 크기와 앱 로드 크기가 일치하지 않습니다.");
      }
    } catch (err) {
      setTranscript("");
      setTranscriptStats(null);
      setError(`전사본 파일을 읽지 못했습니다: ${err.message}`);
    }
  };

  const generate = async () => {
    if (!transcript.trim()) {
      setError("먼저 전사본 파일을 업로드해주세요.");
      return;
    }
    if (!transcriptStats?.verified) {
      setError("전사본 전체 로드 검증이 완료되지 않았습니다. 파일을 다시 업로드해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);
    setCopyMsg("");
    setEnglishProgress("");
    setFinishReasons({});
    setBlockLoading({ insights: true, speaking: true, english: true, common: true });

    try {
      const studyTopic = getTopic(topicSelect, topicCustom);
      const verifiedTranscript = buildTranscriptInput(transcript, transcriptStats);

      const speakingText = computeSpeakingStats(transcript);
      setBlockLoading((prev) => ({ ...prev, speaking: false }));

      const [insRes] = await Promise.allSettled([
        callAPI(buildInsightsPrompt(transcript, studyTopic), 4000),
      ]);

      const insightsText = insRes.status === "fulfilled" ? insRes.value.text : `오류: ${insRes.reason?.message || "인사이트 생성 실패"}`;
      if (insRes.status === "fulfilled") {
        if (insRes.value.model) setUsedModel(insRes.value.model);
        if (insRes.value.finishReason) setFinishReasons((prev) => ({ ...prev, insights: insRes.value.finishReason }));
      }

      setBlockLoading((prev) => ({ ...prev, insights: false }));
      setResults({ insights: insightsText, speaking: speakingText, english: "", englishParts: [], common: "" });

      const nameList = extractNamesFromSpeaking(speakingText);
      if (nameList.length > 0) setParticipants(nameList.join(", "));

      const englishParts = [];
      for (let i = 0; i < nameList.length; i++) {
        const name = nameList[i];
        setEnglishProgress(`${i + 1} / ${nameList.length}명 분석 중 (${name})`);
        const speakerLines = extractSpeakerLines(transcript, name);
        let result = "";
        try {
          const engRes = await callAPI(buildEnglishPromptForOne(name, speakerLines), 8192);
          result = engRes.text;
          if (engRes.finishReason) setFinishReasons((prev) => ({ ...prev, [`english_${name}`]: engRes.finishReason }));
        } catch(e) {
          result = `*[${name}]*\n오류: ${e.message}`;
        }
        englishParts.push(result);
        setResults((prev) => ({
          ...prev,
          english: `🗣️ *영어 표현 교정 꿀팁*\n\n${englishParts.join("\n\n")}`,
          englishParts: [...englishParts],
        }));
      }

      if (nameList.length === 0) {
        setResults((prev) => ({
          ...prev,
          english: "🗣️ *영어 표현 교정 꿀팁*\n\n(참석자 이름을 추출하지 못했습니다)",
        }));
      }

      setBlockLoading((prev) => ({ ...prev, english: false }));
      setEnglishProgress("");

      let commonText = "";
      try {
        const commonRes = await callAPI(buildCommonFeedbackPrompt(transcript), 4000);
        commonText = commonRes.text;
        if (commonRes.finishReason) setFinishReasons((prev) => ({ ...prev, common: commonRes.finishReason }));
      } catch (e) {
        commonText = `오류: ${e.message}`;
      }
      setResults((prev) => ({ ...prev, common: commonText }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBlockLoading((prev) => ({ ...prev, english: false, common: false }));
      setEnglishProgress("");
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!results) return;
    const full = buildFullMessage({
      results,
      studyDate,
      participants,
      topic: getTopic(topicSelect, topicCustom),
    });

    const showCopyMsg = (msg) => {
      setCopyMsg(msg);
      setTimeout(() => setCopyMsg(""), 2500);
    };

    const doFallback = () => {
      const ta = document.createElement("textarea");
      ta.value = full;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        showCopyMsg("✓ 복사됐어요!");
      } catch {
        showCopyMsg("직접 선택해서 복사해주세요");
      }
      document.body.removeChild(ta);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(full).then(() => showCopyMsg("✓ 복사됐어요!")).catch(doFallback);
    } else {
      doFallback();
    }
  };

  const sendToSlack = async () => {
    if (!results) return;

    const postSlack = async (payload) => {
      const res = await fetch("/api/send-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) throw new Error("Slack 전송 실패");
    };

    try {
      setSlackMsg("전송 중...");

      await postSlack(buildSlackPayload({
        results,
        studyDate,
        participants,
        topic: getTopic(topicSelect, topicCustom),
      }));

      const parts = results.englishParts || [];
      const names = extractNamesFromSpeaking(results.speaking || "");
      for (let i = 0; i < parts.length; i++) {
        const name = names[i] || `참가자 ${i + 1}`;
        const content = parts[i].replace(/^\*\[.+?\]\*\s*\n*/s, "").trim();
        const header = i === 0 ? `🗣️ *영어 표현 교정 꿀팁*\n\n*[${name}]*\n\n` : `*[${name}]*\n\n`;
        await postSlack({ attachments: [{ color: "#F5A623", text: header + content, mrkdwn_in: ["text"] }] });
      }

      if (results.common) {
        await postSlack({ attachments: [{ color: "#E91E8C", text: results.common, mrkdwn_in: ["text"] }] });
      }

      setSlackMsg("✓ 전송 완료! 슬랙 채널을 확인해주세요");
    } catch {
      setSlackMsg("❌ 전송 실패 — Slack 설정을 확인해주세요");
    }
    setTimeout(() => setSlackMsg(""), 4000);
  };

  const showBlocks = loading || !!results;
  const allReady = !!results && !loading;

  return (
    <div style={{ maxWidth: 660, margin: "0 auto", padding: "1.5rem 1rem 2rem", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 6 }}>📄 전사본 파일 업로드 (.txt)</label>
        <div
          onClick={() => fileRef.current.click()}
          style={{
            border: "1.5px dashed #d0d0d0",
            borderRadius: 10,
            padding: "18px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: fileName ? "#f0f7f0" : "#fafafa",
          }}
        >
          {fileName ? (
            <span style={{ fontSize: 13, color: "#2d7a3a", fontWeight: 500 }}>✓ {fileName}</span>
          ) : (
            <span style={{ fontSize: 13, color: "#aaa" }}>클릭해서 파일 선택</span>
          )}
        </div>
        {transcriptStats && (
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: transcriptStats.verified ? "#2d7a3a" : "#c0392b",
              textAlign: "right",
              lineHeight: 1.6,
            }}
          >
            <div>
              {transcriptStats.verified ? "✓ 전체 로드 검증 완료" : "⚠ 전체 로드 검증 실패"}
              {" · 원본 "}
              {transcriptStats.fileBytesLabel} bytes / 로드 {transcriptStats.loadedBytesLabel} bytes
            </div>
            <div style={{ color: "#888" }}>
              📊 {transcriptStats.chars}자 · {transcriptStats.words}단어
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".txt" onChange={handleFile} style={{ display: "none" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5 }}>
            스터디 일자 {studyDate && <span style={{ color: "#2d7a3a", fontSize: 11 }}>✓ 자동 추출</span>}
          </label>
          <input
            type="date"
            value={studyDate}
            onChange={(e) => setStudyDate(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              height: 36,
              border: `0.5px solid ${studyDate ? "#a8d5b5" : "#d0d0d0"}`,
              borderRadius: 7,
              padding: "0 10px",
              fontSize: 13,
              background: studyDate ? "#f0f7f0" : "#fafafa",
              color: "#222",
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5 }}>
            참석자 {participants && <span style={{ color: "#2d7a3a", fontSize: 11 }}>✓ 발화량에서 추출</span>}
          </label>
          <input
            type="text"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="생성 후 자동 채워짐"
            style={{
              width: "100%",
              boxSizing: "border-box",
              height: 36,
              border: `0.5px solid ${participants ? "#a8d5b5" : "#d0d0d0"}`,
              borderRadius: 7,
              padding: "0 10px",
              fontSize: 13,
              background: participants ? "#f0f7f0" : "#fafafa",
            }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 5 }}>스터디 주제 카테고리</label>
        <select
          value={topicSelect}
          onChange={(e) => setTopicSelect(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box",
            height: 36,
            border: "0.5px solid #d0d0d0",
            borderRadius: 7,
            padding: "0 10px",
            fontSize: 13,
            background: "#fafafa",
            color: topicSelect ? "#222" : "#aaa",
          }}
        >
          <option value="" disabled>카테고리 선택</option>
          <option>건설/에너지</option>
          <option>기계/산업재</option>
          <option>레저/호텔/엔터</option>
          <option>자동차</option>
          <option>바이오/의료기기/화학</option>
          <option>반도체</option>
          <option>소비재/유통</option>
          <option>조선/방산(항공·우주 포함)</option>
          <option>금융</option>
          <option>AI/IT/플랫폼/게임</option>
          <option>기타</option>
        </select>
        {topicSelect === "기타" && (
          <input
            type="text"
            value={topicCustom}
            onChange={(e) => setTopicCustom(e.target.value)}
            placeholder="직접 입력해주세요"
            style={{
              marginTop: 8,
              width: "100%",
              boxSizing: "border-box",
              height: 36,
              border: "0.5px solid #d0d0d0",
              borderRadius: 7,
              padding: "0 10px",
              fontSize: 13,
              background: "#fafafa",
            }}
          />
        )}
      </div>

      <button
        onClick={generate}
        disabled={loading}
        style={{
          width: "100%",
          padding: "10px 0",
          fontSize: 14,
          fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer",
          border: "0.5px solid #ccc",
          borderRadius: 8,
          background: loading ? "#f0f0f0" : "#fff",
          color: loading ? "#aaa" : "#222",
          marginBottom: 8,
        }}
      >
        {loading ? "⏳ 분석 중..." : "✨ 슬랙 메시지 생성"}
      </button>

      {error && <div style={{ marginTop: 8, padding: "10px 13px", background: "#fff0f0", borderRadius: 8, color: "#c0392b", fontSize: 13 }}>{error}</div>}

      {showBlocks && (
        <div style={{ marginTop: 20 }}>
          <div style={{ border: "0.5px solid #e0e0e0", borderRadius: 12, marginBottom: 12, background: "#f8f8f8", padding: "13px 16px" }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8, fontWeight: 500 }}>📋 스터디 정보</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.9, fontFamily: "monospace", color: "#333" }}>
              <div>📅 <strong>스터디 일자</strong>: {getDateLabel(studyDate)}</div>
              <div>👥 <strong>참석자</strong>: {participants.trim() || "(분석 후 자동 채워짐)"}</div>
              <div>📌 <strong>주제</strong>: {getTopic(topicSelect, topicCustom)}</div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: 0 }}>생성된 슬랙 메시지</p>
            {usedModel && (
              <span style={{ fontSize: 11, color: "#999", background: "#f3f3f3", borderRadius: 4, padding: "2px 7px" }}>
                {usedModel}
              </span>
            )}
          </div>

          {blockMeta.map((m) => {
            let finishInfo = null;
            if (m.key === "insights" && finishReasons.insights) {
              finishInfo = finishReasons.insights;
            } else if (m.key === "english") {
              const parts = Object.entries(finishReasons)
                .filter(([k]) => k.startsWith("english_"))
                .map(([k, v]) => `${k.replace("english_", "")}: ${v}`);
              if (parts.length > 0) finishInfo = parts;
            } else if (m.key === "common" && finishReasons.common) {
              finishInfo = finishReasons.common;
            }
            return (
              <div key={m.key}>
                <SlackBlock meta={m} content={results?.[m.key] || ""} loading={blockLoading[m.key]} finishInfo={finishInfo} />
                {m.key === "english" && englishProgress && (
                  <div style={{ fontSize: 11, color: "#888", textAlign: "right", marginTop: -8, marginBottom: 12 }}>
                    ⏳ {englishProgress}
                  </div>
                )}
              </div>
            );
          })}

          {allReady && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={copyAll}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  borderRadius: 8,
                  border: copyMsg ? "1.5px solid #2d7a3a" : "1.5px solid #333",
                  background: copyMsg ? "#e6f4ea" : "#222",
                  color: copyMsg ? "#2d7a3a" : "#fff",
                  transition: "all 0.2s",
                }}
              >
                {copyMsg || "📋 슬랙 메시지 전체 복사"}
              </button>
              <button
                onClick={sendToSlack}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  borderRadius: 8,
                  border: slackMsg.startsWith("✓") ? "1.5px solid #2d7a3a" : "1.5px solid #4A154B",
                  background: slackMsg.startsWith("✓") ? "#e6f4ea" : "#4A154B",
                  color: slackMsg.startsWith("✓") ? "#2d7a3a" : "#fff",
                  transition: "all 0.2s",
                }}
              >
                {slackMsg || "📨 고정 채널로 슬랙 전송"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
