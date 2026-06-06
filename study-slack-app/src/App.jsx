import { useRef, useState } from "react";

const blockMeta = [
  { key: "insights", icon: "📈", label: "오늘의 주식 스터디 인사이트" },
  { key: "speaking", icon: "🎙️", label: "사용자 발화량 분석" },
  { key: "english", icon: "🗣️", label: "영어 표현 교정 꿀팁" },
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

  return data.text || "";
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

const buildSpeakingPrompt = (transcript) => `주식 스터디 전사본에서 화자별 발화량을 문장 수 기준으로 계산하세요.
문장은 마침표(.), 물음표(?), 느낌표(!) 기준으로 셉니다.

형식:
첫 줄: 🎙️ *사용자 발화량 분석*
빈 줄
이름: 문장 수 N개 · 전체 비중 XX% — 문장 수 많은 순 정렬
코멘트 없이 수치만. 설명 없이 결과만 반환.

전사본:
${transcript}`;

const buildEnglishPromptForOne = (name, speakerLines) => `아래는 주식 스터디에서 "${name}"이(가) 발화한 내용입니다.
영어 실력 향상에 가장 도움이 될 문장을 최대 5개 골라 교정해주세요.

[선별 우선순위]
1. 반복 오류 패턴
2. 오해 유발 표현
3. 명백한 문법 오류 (시제·관사·전치사)
4. 콜로케이션 오류
5. 어휘 다양성 부족
6. 레지스터 불일치
(소통에 지장 없는 사소한 오류 제외)

[출력 형식 — 엄수]
*[${name}]*
(영어 발화가 없으면 이 줄 다음에 "(영어 발화 없음)" 한 줄만 쓰고 끝낼 것)

영어 발화가 있으면:
1. *핵심 포인트 짧게*
❌ 원문: \`실제 발화 문장\`
✅ 추천: \`자연스러운 전체 문장\`
💡 이유: 한 줄

각 항목 사이에는 빈 줄을 넣을 것.
❌는 어색하거나 고칠 표현, ✅는 바로 따라 말하면 좋은 표현으로 명확히 구분.
Slack에서 잘 보이도록 원문과 추천 표현은 반드시 \`인라인 코드\`로 감쌀 것.

(최대 5개, 설명 없이 결과만 반환)

${name}의 발화:
${speakerLines || "(발화 내용 없음)"}`;

function SlackBlock({ meta, content, loading }) {
  return (
    <div style={{ border: "0.5px solid #e0e0e0", borderRadius: 12, marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "9px 14px",
          background: "#f8f8f8",
          borderBottom: "0.5px solid #e8e8e8",
          borderRadius: "12px 12px 0 0",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, color: "#555" }}>
          {meta.icon} {meta.label}
        </span>
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
      {
        color: "#E01E5A",
        text: results.english || "",
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
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith(".txt")) {
      setError(".txt 파일만 업로드할 수 있어요.");
      return;
    }

    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      setTranscript(text);
      setTranscriptStats({
        chars: text.length.toLocaleString(),
        words: text.split(/\s+/).filter(Boolean).length.toLocaleString(),
      });

      const dateRegex = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/;
      const dm = file.name.match(dateRegex) || text.slice(0, 2000).match(dateRegex);
      if (dm) {
        const [, y, mo, d] = dm;
        setStudyDate(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
      }
      setParticipants("");
    };
    reader.readAsText(file, "utf-8");
  };

  const generate = async () => {
    if (!transcript.trim()) {
      setError("먼저 전사본 파일을 업로드해주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setResults(null);
    setCopyMsg("");
    setEnglishProgress("");
    setBlockLoading({ insights: true, speaking: true, english: true });

    try {
      const studyTopic = getTopic(topicSelect, topicCustom);

      const [insRes, spkRes] = await Promise.allSettled([
        callAPI(buildInsightsPrompt(transcript, studyTopic), 500),
        callAPI(buildSpeakingPrompt(transcript), 400),
      ]);

      const insightsText = insRes.status === "fulfilled" ? insRes.value : `오류: ${insRes.reason?.message || "인사이트 생성 실패"}`;
      const speakingText = spkRes.status === "fulfilled" ? spkRes.value : `오류: ${spkRes.reason?.message || "발화량 분석 실패"}`;

      setBlockLoading((prev) => ({ ...prev, insights: false, speaking: false }));
      setResults({ insights: insightsText, speaking: speakingText, english: "" });

      const nameList = spkRes.status === "fulfilled" ? extractNamesFromSpeaking(speakingText) : [];
      if (nameList.length > 0) setParticipants(nameList.join(", "));

      const englishParts = [];
      for (let i = 0; i < nameList.length; i++) {
        const name = nameList[i];
        setEnglishProgress(`${i + 1} / ${nameList.length}명 분석 중 (${name})`);
        const speakerLines = extractSpeakerLines(transcript, name);
        let result = "";
        try {
          result = await callAPI(buildEnglishPromptForOne(name, speakerLines), 1800);
        } catch (e) {
          result = `*[${name}]*\n오류: ${e.message}`;
        }
        englishParts.push(result);
        setResults((prev) => ({
          ...prev,
          english: `🗣️ *영어 표현 교정 꿀팁*\n\n${englishParts.join("\n\n")}`,
        }));
      }

      if (nameList.length === 0) {
        setResults((prev) => ({
          ...prev,
          english: spkRes.status === "fulfilled"
            ? "🗣️ *영어 표현 교정 꿀팁*\n\n(참석자 이름을 추출하지 못했습니다)"
            : "🗣️ *영어 표현 교정 꿀팁*\n\n(발화량 분석 실패로 영어 교정을 건너뛰었습니다)",
        }));
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBlockLoading((prev) => ({ ...prev, english: false }));
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

    const payload = buildSlackPayload({
      results,
      studyDate,
      participants,
      topic: getTopic(topicSelect, topicCustom),
    });

    try {
      setSlackMsg("전송 중...");
      const response = await fetch("/api/send-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (!response.ok) throw new Error("Slack 전송 실패");
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
          <div style={{ marginTop: 6, fontSize: 11, color: "#888", textAlign: "right" }}>
            📊 {transcriptStats.chars}자 · {transcriptStats.words}단어 로드됨
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

          <p style={{ fontSize: 13, fontWeight: 500, color: "#333", margin: "0 0 10px" }}>생성된 슬랙 메시지</p>

          {blockMeta.map((m) => (
            <div key={m.key}>
              <SlackBlock meta={m} content={results?.[m.key] || ""} loading={blockLoading[m.key]} />
              {m.key === "english" && englishProgress && (
                <div style={{ fontSize: 11, color: "#888", textAlign: "right", marginTop: -8, marginBottom: 12 }}>
                  ⏳ {englishProgress}
                </div>
              )}
            </div>
          ))}

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
