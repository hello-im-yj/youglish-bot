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
  const res = await fetch("/api/openai", {
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

목적은 단순 요약이 아니라, 스터디 대화에서 나온 내용을 바탕으로 "투자 가설"을 만드는 것입니다.
어떤 주제의 대화든, 소비자 행동·산업 변화·기업 경쟁력·브랜드 리스크·기술 변화·매크로 변수와 연결될 수 있으면 투자 인사이트로 추출하세요.

단, 너무 뻔하고 넓은 표현은 피해주세요.
예를 들어 아래처럼 끝나는 문장은 좋은 인사이트가 아닙니다.

- 수요 증가 예상
- 성장 가능성 있음
- 리스크 존재
- 경쟁 심화
- 전략 필요
- 시장 재편 가능성
- 관심 확대
- 섹터 수혜 가능성

이런 표현을 쓸 경우, 반드시 "그래서 돈이 어디로 이동할 수 있는지", "어떤 기업군/섹터가 수혜 또는 피해를 볼 수 있는지", "다음에 어떤 지표를 확인해야 하는지"까지 연결해주세요.

[인사이트 추출 기준 — 하나라도 해당하면 추출 가능]

- 기업·브랜드·제품에 대한 인식 변화
- 소비자 행동·생활 패턴·구매 경로·선호도 변화
- 산업 구조 변화, 시장 성장·축소 신호
- 기술·규제·정책 트렌드
- 경쟁 환경 변화, 신규 플레이어 등장
- 종목·섹터 직접 언급, 실적·전략 관련 내용
- 매크로 지표, 금리·환율·원자재 등 거시 변수
- 일상 속 소비 경험에서 포착되는 시장 신호
- 특정 제품군의 가격 프리미엄, 재구매, 유통 채널 변화
- 브랜드 논란, 불매, 이미지 훼손, 대체재 이동 가능성

[좋은 인사이트의 조건]

각 인사이트는 반드시 아래 3가지 요소를 포함해야 합니다.

1. 관찰된 현상
   전사본에서 실제로 나온 소비자 행동, 브랜드 인식, 시장 변화

2. 투자 가설
   이 현상이 돈의 흐름, 매출, 마진, 점유율, 광고비, 트래픽, 유통 채널, 브랜드 가치에 어떤 영향을 줄 수 있는지

3. 확인할 액션
   다음 스터디 전까지 확인해볼 지표, 기업군, 섹터, 데이터, 질문 중 1개 이상

[출력 형식]

📈 *오늘의 주식 스터디 인사이트* (${topic})

각 인사이트는 반드시 아래 형식의 한 줄로만 작성하세요.

• 이모지 *핵심 투자 가설* → 수혜/피해: ___ / 확인: ___

예시:
• 🛒 *AI 쇼핑 에이전트가 e-커머스 앱의 트래픽 독점력을 약화시킬 수 있음* → 수혜/피해: 구글·유튜브·결제/광고 플랫폼 수혜, 쿠팡·아마존은 광고 매출 방어 필요 / 확인: 쇼핑 광고 매출·앱 체류시간·결제 전환율
• 💪 *단백질 음료는 헬스 보충제보다 '편의점 건강 간편식'으로 봐야 함* → 수혜/피해: 편의점·RTD 음료·단백질 원료 기업 수혜 가능, 기존 헬스 보충제 브랜드는 포지셔닝 재점검 필요 / 확인: 편의점 SKU 증가·가격 프리미엄·재구매율
• ☕ *브랜드 논란은 단기 불매보다 방문 빈도와 선불카드 환불로 이어지는지가 핵심* → 수혜/피해: 대체 커피 브랜드·편의점 커피 반사이익 가능, 글로벌 소비재 브랜드는 캠페인 리스크 확대 / 확인: 스타벅스 트래픽·앱 이용률·대체 브랜드 검색량

[이모지 규칙]

제목에는 📈를 사용하세요.
각 인사이트 줄은 📈를 반복하지 말고, 내용에 맞는 서로 다른 이모지 1개로 시작하세요.

예:
소비/유통 📦🛒 / 식음료 ☕🍔 / 헬스 💪 / 자동차 🚗 / 반도체 🔌 / 금융 💳 / AI/IT 🤖 / 에너지 ⚡ / 조선/방산 🚢 / 바이오 🧬 / 엔터 🎬 / 브랜드 리스크 ⚠️ / 매크로 🌏

[제외]

- 스터디 일정·운영 공지
- 순수 잡담
- 인사말
- 투자 시사점으로 연결하기 어려운 개인적 반응
- 전사 오류가 심해서 의미가 불분명한 내용

[주의사항]

- 개별 종목 매수/매도 추천처럼 쓰지 마세요.
- "수혜 가능성"만 쓰고 끝내지 말고, 반드시 확인할 지표나 액션을 붙이세요.
- 전사본에 없는 내용을 과하게 상상하지 마세요.
- 다만 전사본의 논의를 바탕으로 투자 관점의 합리적 가설은 만들어도 됩니다.
- 너무 일반적인 컨설팅 문장보다, 실제 주식 스터디에서 다음에 조사할 수 있는 문장으로 작성하세요.
- 각 줄의 "확인:"에는 반드시 실제로 찾아볼 수 있는 지표, 데이터, 기업군, 질문을 넣으세요.
- 결과만 반환하세요. 부연 설명 없이 제목과 인사이트 줄만 출력하세요.
- 최대 5개만 출력하세요.

전사본:
${transcript}`;


const buildEnglishPromptForOne = (name, speakerLines) => `아래는 영어 스터디에서 ${name}이(가) 발화한 내용이야.
발화를 모두 훑고, 영어 표현 피드백 가치가 가장 높은 발화 최대 5개를 골라 피드백해줘.

이 작업의 목적은 단순한 문법 교정이 아니야.
${name}이(가) 다음 스터디에서 더 자연스럽고 원어민다운 방식으로 말할 수 있도록 돕는 거야.

[가장 중요한 원칙]
✅ 추천 표현은 "문법 교정문"이 아니라 thought-level paraphrase여야 해.
원문의 의도를 살리되, 실제 영어 토론에서 자연스럽게 들리도록 문장 전체를 다시 구성해줘.
원문과 구조가 거의 같고 단어 몇 개만 바뀐 경우는 실패한 답변이야.

나쁜 예:
❌ 원문: Physical convergence is becoming more important when you buying products.
✅ 추천: Physical convergence is becoming more important when you buy products.
→ 단순 문법 교정이라 가치 없음

좋은 예:
❌ 원문: Physical convergence is becoming more important when you buying products.
✅ 추천: The line between online and offline shopping is getting blurrier, and it's starting to shape how people make purchasing decisions.
→ 원문의 의도를 살린 통문장 패러프레이즈

[문장 선정 기준 — 우선순위순]
1. 통문장 패러프레이즈 가치: 문장 전체를 더 자연스럽고 풍부하게 바꿀 수 있는 발화 우선
2. 재사용 가능성: 다음 스터디에서도 비슷한 상황에 쓸 수 있는 발화 (질문 꺼내기, 경험 말하기, 의견 제시, 이유 설명, 비교, 반응, 주제 전환 등)
3. 개선 효과: 바꿨을 때 표현력이 크게 좋아지는 발화 (관사·단복수·시제만 고치면 되는 건 낮은 우선순위)
4. 반복 습관: 한국어식 패턴이나 어색한 구조가 반복되는 발화
5. 의미 명확성: 전사 오류가 있어도 문맥상 의미가 비교적 명확한 발화

[가능하면 포함할 발화 유형]
질문하는 발화 / 경험을 말하는 발화 / 의견을 말하는 발화 / 이유·근거를 설명하는 발화 / 비교하거나 상대 의견에 반응하는 발화
단, 유형 맞추기보다 통문장 패러프레이즈 가치와 재사용 가능성을 우선해줘.

[무조건 제외]
- Yeah / Okay / Right 등 짧은 반응어
- like / you know / kind of 같은 필러 워드 — 구어체에서 자연스러움
- 단어 하나·관사·단복수·시제·전치사만 고치면 되는 문장
- 전사 오류가 심해 의미 추정이 어려운 문장
- 일부만 잘려서 독립적으로 의미가 불분명한 발화
- 한국어 발화
- 발화자가 반복한 말, 의미를 억지로 만들어야 하는 발화
- 재사용하기 너무 특수한 문장

[✅ 추천 표현 작성 기준]
- 단어 몇 개만 고치지 말고, 문장 전체를 자연스럽게 다시 써줘
- 실제 영어 토론에서 원어민이 말할 법한 발화로 바꿔줘
- 딱딱한 발표체·논문식 영어 대신 자연스러운 토론체로 써줘
- 원문이 길거나 어색하면 두 문장으로 나눠도 돼
- 같은 발화자의 연속된 1~3문장이 하나의 생각이면 묶어서 하나의 원문으로 써도 돼
- 참가자가 다음 스터디에서 그대로 따라 말할 수 있을 정도로 실용적이어야 해

[💡 이유 작성 기준]
- 관사, 복수형 같은 사소한 문법 설명은 쓰지 마
- "이 상황에서 이런 식으로 생각 단위를 구성하면 자연스럽다", "이 패턴을 다음에도 응용할 수 있다" 위주로 써줘
- 2문장 이내로 작성

[출력 형식 — 이 형식 외 다른 텍스트 없이]
*[${name}]*

*1. [이 교정의 핵심을 한 구절로]*
> ❌ 원문: 원문 발화 (연속 발화면 그대로 묶어서)
> ✅ 추천: 통문장 패러프레이즈 1~2문장
> 💡 이유: 한국어로 2문장 이내

(각 항목 사이 빈 줄 필수, 최대 5개)
피드백할 발화가 5개 미만이어도 억지로 채우지 마.

*이번 주 표현 포인트*
• 반복되는 표현 습관: (없으면 생략)
• 다음 스터디에서 바로 써볼 표현:
  -
  -
  -

영어 발화가 없으면 "*[${name}]*" 다음 줄에 "(영어 발화 없음)"만 출력.

[피드백 톤] 코칭하듯 부드럽게. "틀렸다"보다 "이렇게 말하면 훨씬 자연스럽다" 위주.
사소한 문법보다 더 풍부하고 자연스러운 표현 방식에 집중해줘.

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
  const hasMaxTokens = finishInfo && (Array.isArray(finishInfo) ? finishInfo : [finishInfo]).some((f) => f.includes("MAX_TOKENS") || f.includes("length"));
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
                  background: b.includes("MAX_TOKENS") || b.includes("length") ? "#fff0f0" : "#f0f7f0",
                  color: b.includes("MAX_TOKENS") || b.includes("length") ? "#c0392b" : "#2d7a3a",
                }}
              >
                {b.replace(/\b(STOP|stop)\b/g, "✅").replace(/\blength\b/g, "MAX_TOKENS")}
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
        const commonRes = await callAPI(buildCommonFeedbackPrompt(transcript), 8192);
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
