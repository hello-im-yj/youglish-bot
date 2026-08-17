import { useRef, useState } from "react";
import {
  extractNamesFromSpeaking,
  extractSpeakerLines,
  computeSpeakingStats,
  buildTranscriptInput,
  buildInsightsPrompt,
  buildEnglishPromptForOne,
  buildCommonFeedbackPrompt,
  buildCorrectionPrompt,
} from "./prompts.js";

const blockMeta = [
  { key: "insights", icon: "📈", label: "오늘의 주식 스터디 인사이트" },
  { key: "speaking", icon: "🎙️", label: "사용자 발화량 분석" },
  { key: "english", icon: "🗣️", label: "영어 표현 교정 꿀팁" },
  { key: "common", icon: "💬", label: "이번 스터디 공통 표현 개선 포인트" },
];

async function callAPI(content, maxTokens) {
  const res = await fetch("/api/claude", {
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

function SlackBlock({ meta, content, loading, finishInfo }) {
  const isTruncated = (t) => /max_tokens|length/i.test(t);
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
                  background: isTruncated(b) ? "#fff0f0" : "#f0f7f0",
                  color: isTruncated(b) ? "#c0392b" : "#2d7a3a",
                }}
              >
                {b.replace(/\b(end_turn|stop)\b/gi, "✅").replace(/\b(max_tokens|length)\b/gi, "⚠️ 잘림")}
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
  const [auxFileName, setAuxFileName] = useState("");
  const [auxTranscript, setAuxTranscript] = useState("");
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [dragMain, setDragMain] = useState(false);
  const [dragAux, setDragAux] = useState(false);
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
  const auxFileRef = useRef();

  const processFile = async (file) => {
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
    setAuxFileName("");
    setAuxTranscript("");
    setCorrectionNotes("");
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

  const processAuxFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith(".txt")) {
      setError("보조 전사본도 .txt 파일만 업로드할 수 있어요.");
      return;
    }
    try {
      const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
      setAuxFileName(file.name);
      setAuxTranscript(text);
      setCorrectionNotes("");
    } catch (err) {
      setAuxFileName("");
      setAuxTranscript("");
      setError(`보조 전사본 파일을 읽지 못했습니다: ${err.message}`);
    }
  };

  const handleFile = (e) => processFile(e.target.files[0]);
  const handleAuxFile = (e) => processAuxFile(e.target.files[0]);

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
    setCorrectionNotes("");
    setBlockLoading({ insights: true, speaking: true, english: true, common: true });

    try {
      const studyTopic = getTopic(topicSelect, topicCustom);
      const verifiedTranscript = buildTranscriptInput(transcript, transcriptStats);

      let notes = "";
      if (auxTranscript.trim()) {
        setEnglishProgress("보조 전사본 대조 중...");
        try {
          const corrRes = await callAPI(buildCorrectionPrompt(transcript, auxTranscript), 4000);
          notes = corrRes.text.includes("유의미한 전사 오류 없음") ? "" : corrRes.text;
          setCorrectionNotes(corrRes.text);
        } catch (e) {
          setCorrectionNotes(`(전사 대조 실패: ${e.message} — 보정 없이 분석을 진행합니다)`);
        }
        setEnglishProgress("");
      }
      const analysisInput = notes
        ? `${verifiedTranscript}

[전사 교정 노트 — 보조 전사본과 대조해 찾은 오류 목록. 아래 오류를 감안해 교정된 의미를 기준으로 분석할 것]
${notes}`
        : verifiedTranscript;

      const speakingText = computeSpeakingStats(transcript);
      setBlockLoading((prev) => ({ ...prev, speaking: false }));

      const [insRes] = await Promise.allSettled([
        callAPI(buildInsightsPrompt(analysisInput, studyTopic), 4000),
      ]);

      const resultTag = (r) => [r.finishReason, r.model].filter(Boolean).join(" · ");
      const insightsText = insRes.status === "fulfilled" ? insRes.value.text : `오류: ${insRes.reason?.message || "인사이트 생성 실패"}`;
      if (insRes.status === "fulfilled") {
        if (insRes.value.model) setUsedModel(insRes.value.model);
        if (insRes.value.finishReason) setFinishReasons((prev) => ({ ...prev, insights: resultTag(insRes.value) }));
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
          const engRes = await callAPI(buildEnglishPromptForOne(name, speakerLines, notes), 8192);
          result = engRes.text;
          if (engRes.finishReason) setFinishReasons((prev) => ({ ...prev, [`english_${name}`]: resultTag(engRes) }));
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
        const commonRes = await callAPI(buildCommonFeedbackPrompt(analysisInput), 8192);
        commonText = commonRes.text;
        if (commonRes.finishReason) setFinishReasons((prev) => ({ ...prev, common: resultTag(commonRes) }));
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
    if (!results || slackMsg === "전송 중...") return;

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
          onDragOver={(e) => { e.preventDefault(); setDragMain(true); }}
          onDragLeave={() => setDragMain(false)}
          onDrop={(e) => { e.preventDefault(); setDragMain(false); processFile(e.dataTransfer.files[0]); }}
          style={{
            border: dragMain ? "1.5px dashed #2d7a3a" : "1.5px dashed #d0d0d0",
            borderRadius: 10,
            padding: "18px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragMain ? "#e6f4ea" : fileName ? "#f0f7f0" : "#fafafa",
          }}
        >
          {fileName ? (
            <span style={{ fontSize: 13, color: "#2d7a3a", fontWeight: 500 }}>✓ {fileName}</span>
          ) : (
            <span style={{ fontSize: 13, color: "#aaa" }}>클릭 또는 파일을 여기로 드래그</span>
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

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "#888", display: "block", marginBottom: 6 }}>
          📑 보조 전사본 (선택) — 다른 전사 앱의 결과와 대조해 오류를 보정합니다
        </label>
        <div
          onClick={() => auxFileRef.current.click()}
          onDragOver={(e) => { e.preventDefault(); setDragAux(true); }}
          onDragLeave={() => setDragAux(false)}
          onDrop={(e) => { e.preventDefault(); setDragAux(false); processAuxFile(e.dataTransfer.files[0]); }}
          style={{
            border: dragAux ? "1.5px dashed #2c5aa0" : "1.5px dashed #d0d0d0",
            borderRadius: 10,
            padding: "12px 16px",
            textAlign: "center",
            cursor: "pointer",
            background: dragAux ? "#e8f0fa" : auxFileName ? "#f0f4fa" : "#fafafa",
          }}
        >
          {auxFileName ? (
            <span style={{ fontSize: 13, color: "#2c5aa0", fontWeight: 500 }}>✓ {auxFileName}</span>
          ) : (
            <span style={{ fontSize: 13, color: "#aaa" }}>클릭 또는 드래그 (없어도 됩니다)</span>
          )}
        </div>
        <input ref={auxFileRef} type="file" accept=".txt" onChange={handleAuxFile} style={{ display: "none" }} />
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

          {correctionNotes && (
            <div style={{ border: "0.5px solid #e8dcb0", borderRadius: 12, marginBottom: 12, background: "#fffdf4", padding: "13px 16px" }}>
              <div style={{ fontSize: 12, color: "#9a7d1f", marginBottom: 8, fontWeight: 500 }}>
                🔧 전사 보정 노트 (보조 전사본 대조 · 슬랙 메시지에는 포함되지 않아요)
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.8, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#555" }}>
                {correctionNotes}
              </div>
            </div>
          )}

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
                disabled={slackMsg === "전송 중..."}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: slackMsg === "전송 중..." ? "not-allowed" : "pointer",
                  borderRadius: 8,
                  border: slackMsg.startsWith("✓") ? "1.5px solid #2d7a3a" : "1.5px solid #4A154B",
                  background: slackMsg === "전송 중..." ? "#7a4a7a" : slackMsg.startsWith("✓") ? "#e6f4ea" : "#4A154B",
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
