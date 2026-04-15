import { useState, useEffect, useRef, useCallback } from "react";

const FALLBACK_QUESTIONS = [
  { question: "Из каких блоков делается верстак?", correct_answer: "Из четырёх досок", difficulty: "easy" },
  { question: "Какой моб появляется, если молния ударит в свинью?", correct_answer: "Зомбифицированный пиглин", difficulty: "hard" },
  { question: "Сколько блоков обсидиана нужно для портала в Нижний мир?", correct_answer: "Минимум 10 блоков", difficulty: "medium" },
  { question: "Какой предмет нужен, чтобы добыть алмазную руду?", correct_answer: "Железная кирка или лучше", difficulty: "easy" },
  { question: "Как называется босс, обитающий в Энде?", correct_answer: "Дракон Края (Эндер-дракон)", difficulty: "easy" },
  { question: "Какой блок используется для зачарования предметов?", correct_answer: "Стол зачарований", difficulty: "easy" },
  { question: "Из чего крафтится око Края?", correct_answer: "Из жемчуга Края и огненного порошка", difficulty: "medium" },
  { question: "Какой моб боится воды и телепортируется?", correct_answer: "Эндермен", difficulty: "easy" },
  { question: "Сколько уровней опыта стоит максимальное зачарование?", correct_answer: "30 уровней", difficulty: "hard" },
  { question: "Какой биом содержит грибные коровы?", correct_answer: "Грибной остров (Mushroom Fields)", difficulty: "medium" },
  { question: "Что выпадает с Визера после убийства?", correct_answer: "Звезда Нижнего мира", difficulty: "medium" },
  { question: "Какой блок нельзя сдвинуть поршнем?", correct_answer: "Обсидиан", difficulty: "medium" },
  { question: "Как приручить волка в Minecraft?", correct_answer: "Дать ему кость", difficulty: "easy" },
  { question: "Какой редстоун-компонент даёт сигнал при наступании на него?", correct_answer: "Нажимная пластина", difficulty: "medium" },
  { question: "Сколько голов скелетов-визеров нужно для призыва Визера?", correct_answer: "Три головы", difficulty: "hard" },
];

const TOTAL_QUESTIONS = 10;

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-20250514";

async function callClaude(systemPrompt, userPrompt) {
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) throw new Error("API error");
  const data = await resp.json();
  const text = data.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return text;
}

function parseJSON(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ── Pixel art icons as inline SVGs ──

function MicIcon({ active }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="12" y="4" width="8" height="16" rx="1" fill={active ? "#ff4444" : "#8BC34A"} />
      <path d="M8 16 v2 a8 8 0 0 0 16 0 v-2" stroke={active ? "#ff4444" : "#8BC34A"} strokeWidth="2.5" fill="none" />
      <line x1="16" y1="26" x2="16" y2="30" stroke={active ? "#ff4444" : "#8BC34A"} strokeWidth="2.5" />
      <line x1="11" y1="30" x2="21" y2="30" stroke={active ? "#ff4444" : "#8BC34A"} strokeWidth="2.5" />
    </svg>
  );
}

function StarIcon({ filled }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28">
      <polygon
        points="14,2 17.5,10 26,11 20,17 21.5,26 14,22 6.5,26 8,17 2,11 10.5,10"
        fill={filled ? "#FFD700" : "#555"}
        stroke="#222"
        strokeWidth="1"
      />
    </svg>
  );
}

function PixelHeart() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18">
      <path d="M2 6 Q2 2 6 2 Q10 2 10 6 Q10 2 14 2 Q18 2 18 6 Q18 12 10 17 Q2 12 2 6Z" fill="#e74c3c" />
    </svg>
  );
}

// ── Speech recognition hook ──

function useSpeechRecognition() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recogRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      setSupported(true);
      const r = new SR();
      r.lang = "ru-RU";
      r.continuous = false;
      r.interimResults = true;
      r.onresult = (e) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        setTranscript(t);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recogRef.current = r;
    }
  }, []);

  const start = useCallback(() => {
    if (recogRef.current) {
      setTranscript("");
      setListening(true);
      recogRef.current.start();
    }
  }, []);

  const stop = useCallback(() => {
    if (recogRef.current) recogRef.current.stop();
  }, []);

  return { supported, listening, transcript, start, stop, setTranscript };
}

// ── Main App ──

export default function MinecraftQuiz() {
  const [screen, setScreen] = useState("start"); // start | playing | evaluating | result | final
  const [currentQ, setCurrentQ] = useState(null);
  const [questionNum, setQuestionNum] = useState(0);
  const [scores, setScores] = useState([]);
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [askedQuestions, setAskedQuestions] = useState([]);
  const [textInput, setTextInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const { supported: micSupported, listening, transcript, start, stop, setTranscript } = useSpeechRecognition();
  const fallbackIdx = useRef(0);

  const loadingMessages = [
    "Копаем вопрос из шахты...",
    "Крафтим вопрос...",
    "Спрашиваем у Стива...",
    "Ищем в сундуке...",
    "Зачаровываем вопрос...",
    "Варим вопрос в котле...",
  ];
  const evalMessages = [
    "Оцениваем ответ...",
    "Сверяем с энциклопедией...",
    "Совещаемся с жителями...",
    "Проверяем в вики...",
  ];

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ── Generate question ──
  const generateQuestion = useCallback(async () => {
    setLoading(true);
    setLoadingMsg(pickRandom(loadingMessages));
    setErrorMsg("");
    try {
      const history = askedQuestions.map((q) => `- ${q}`).join("\n");
      const sys = `Ты — генератор вопросов для викторины по Minecraft. Отвечай ТОЛЬКО валидным JSON, без markdown, без пояснений. Формат: {"question":"...","correct_answer":"...","difficulty":"easy|medium|hard"}`;
      const usr = `Придумай один интересный вопрос по Minecraft на русском языке. Тема может быть любая: крафт, мобы, биомы, редстоун, зачарования, Нижний мир, Край, механики игры, обновления.\n\nУже заданные вопросы (НЕ повторяй):\n${history || "пока нет"}\n\nСгенерируй вопрос.`;
      const raw = await callClaude(sys, usr);
      const q = parseJSON(raw);
      if (!q.question || !q.correct_answer) throw new Error("bad format");
      setCurrentQ(q);
      setAskedQuestions((prev) => [...prev, q.question]);
    } catch (e) {
      // fallback
      const fb = FALLBACK_QUESTIONS[fallbackIdx.current % FALLBACK_QUESTIONS.length];
      fallbackIdx.current++;
      setCurrentQ(fb);
      setAskedQuestions((prev) => [...prev, fb.question]);
    }
    setLoading(false);
  }, [askedQuestions]);

  // ── Evaluate answer ──
  const evaluateAnswer = useCallback(
    async (playerAnswer) => {
      if (!playerAnswer.trim()) {
        setErrorMsg("Скажи или напиши ответ!");
        return;
      }
      setScreen("evaluating");
      setLoading(true);
      setLoadingMsg(pickRandom(evalMessages));
      try {
        const sys = `Ты — судья викторины по Minecraft. Оцени ответ игрока по 5-балльной шкале. Отвечай ТОЛЬКО валидным JSON, без markdown. Формат: {"score":число_от_1_до_5,"comment":"краткий комментарий на русском","correct_answer":"полный правильный ответ"}`;
        const usr = `Вопрос: ${currentQ.question}\nПравильный ответ: ${currentQ.correct_answer}\nОтвет игрока: ${playerAnswer}\n\nОцени. 5 = верно или почти верно, 4 = по сути верно но неточно, 3 = частично верно, 2 = слабо но что-то угадал, 1 = неверно. Дай короткий дружелюбный комментарий в стиле Minecraft.`;
        const raw = await callClaude(sys, usr);
        const ev = parseJSON(raw);
        if (!ev.score || !ev.comment) throw new Error("bad format");
        ev.score = Math.max(1, Math.min(5, Math.round(ev.score)));
        setEvaluation(ev);
        setScores((prev) => [...prev, ev.score]);
      } catch (e) {
        // fallback local evaluation
        const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9\s]/g, "");
        const pa = norm(playerAnswer);
        const ca = norm(currentQ.correct_answer);
        let score = 1;
        if (pa === ca) score = 5;
        else if (ca.split(" ").every((w) => w.length > 2 && pa.includes(w))) score = 4;
        else if (ca.split(" ").some((w) => w.length > 2 && pa.includes(w))) score = 3;
        const ev = { score, comment: score >= 4 ? "Отлично!" : score >= 3 ? "Почти!" : "Не совсем...", correct_answer: currentQ.correct_answer };
        setEvaluation(ev);
        setScores((prev) => [...prev, ev.score]);
      }
      setLoading(false);
      setScreen("result");
    },
    [currentQ]
  );

  // ── Handlers ──
  const handleStart = () => {
    setScreen("playing");
    setQuestionNum(1);
    setScores([]);
    setAskedQuestions([]);
    setEvaluation(null);
    setTextInput("");
    setTranscript("");
    fallbackIdx.current = 0;
    generateQuestion();
  };

  const handleNext = () => {
    if (questionNum >= TOTAL_QUESTIONS) {
      setScreen("final");
    } else {
      setQuestionNum((n) => n + 1);
      setEvaluation(null);
      setTextInput("");
      setTranscript("");
      setScreen("playing");
      generateQuestion();
    }
  };

  const handleSubmitAnswer = () => {
    const answer = transcript || textInput;
    evaluateAnswer(answer);
  };

  const totalScore = scores.reduce((a, b) => a + b, 0);
  const avgScore = scores.length ? (totalScore / scores.length).toFixed(1) : 0;
  const maxPossible = scores.length * 5;

  const getDiffColor = (d) => {
    if (d === "easy") return "#8BC34A";
    if (d === "medium") return "#FFC107";
    return "#f44336";
  };
  const getDiffLabel = (d) => {
    if (d === "easy") return "Легко";
    if (d === "medium") return "Средне";
    return "Сложно";
  };

  const getGrade = () => {
    const avg = totalScore / TOTAL_QUESTIONS;
    if (avg >= 4.5) return { emoji: "🏆", text: "Гений Minecraft!", sub: "Ты знаешь эту игру лучше Нотча!" };
    if (avg >= 3.5) return { emoji: "⛏️", text: "Бывалый шахтёр!", sub: "Отличные знания, так держать!" };
    if (avg >= 2.5) return { emoji: "🪨", text: "Начинающий крафтер", sub: "Неплохо, но есть куда расти!" };
    return { emoji: "🌱", text: "Новичок в шахте", sub: "Играй больше — узнаешь больше!" };
  };

  return (
    <div style={styles.container}>
      <div style={styles.scanlines} />

      {/* ── START ── */}
      {screen === "start" && (
        <div style={styles.centered}>
          <div style={styles.title}>
            <span style={styles.titleIcon}>⛏️</span>
            <div>
              <div style={styles.titleMain}>MINECRAFT</div>
              <div style={styles.titleSub}>ВИКТОРИНА</div>
            </div>
            <span style={styles.titleIcon}>🗡️</span>
          </div>
          <div style={styles.subtitle}>Голосовая викторина по Minecraft</div>
          <div style={styles.infoBox}>
            <div style={styles.infoRow}><PixelHeart /> <span>{TOTAL_QUESTIONS} вопросов</span></div>
            <div style={styles.infoRow}><span style={{fontSize:16}}>🎤</span> <span>Отвечай голосом</span></div>
            <div style={styles.infoRow}><span style={{fontSize:16}}>⭐</span> <span>Оценка от 1 до 5</span></div>
          </div>
          <button style={styles.btnPrimary} onClick={handleStart}>
            ▶ НАЧАТЬ ИГРУ
          </button>
        </div>
      )}

      {/* ── PLAYING ── */}
      {screen === "playing" && (
        <div style={styles.playScreen}>
          <div style={styles.topBar}>
            <div style={styles.topBarItem}>#{questionNum}/{TOTAL_QUESTIONS}</div>
            <div style={styles.topBarItem}>⭐ {totalScore}</div>
          </div>

          {loading ? (
            <div style={styles.centered}>
              <div style={styles.loader} />
              <div style={styles.loadingText}>{loadingMsg}</div>
            </div>
          ) : currentQ ? (
            <>
              <div style={styles.diffBadge}>
                <span style={{ ...styles.diffDot, background: getDiffColor(currentQ.difficulty) }} />
                {getDiffLabel(currentQ.difficulty)}
              </div>
              <div style={styles.questionCard}>
                <div style={styles.questionText}>{currentQ.question}</div>
              </div>

              {/* Transcript display */}
              {(transcript || textInput) && (
                <div style={styles.transcriptBox}>
                  <div style={styles.transcriptLabel}>Твой ответ:</div>
                  <div style={styles.transcriptText}>{transcript || textInput}</div>
                </div>
              )}

              {errorMsg && <div style={styles.errorText}>{errorMsg}</div>}

              {/* Voice / text input */}
              <div style={styles.inputArea}>
                {micSupported ? (
                  <button
                    style={{ ...styles.micBtn, ...(listening ? styles.micBtnActive : {}) }}
                    onTouchStart={(e) => { e.preventDefault(); start(); }}
                    onTouchEnd={(e) => { e.preventDefault(); stop(); }}
                    onMouseDown={start}
                    onMouseUp={stop}
                  >
                    <MicIcon active={listening} />
                    <span style={styles.micLabel}>{listening ? "Говори..." : "Зажми и говори"}</span>
                  </button>
                ) : null}

                <div style={styles.textInputRow}>
                  <input
                    style={styles.textField}
                    placeholder="...или напиши ответ"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer()}
                  />
                </div>

                <button
                  style={{ ...styles.btnPrimary, marginTop: 8, opacity: (transcript || textInput) ? 1 : 0.5 }}
                  onClick={handleSubmitAnswer}
                  disabled={!(transcript || textInput)}
                >
                  ✓ ОТВЕТИТЬ
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ── EVALUATING ── */}
      {screen === "evaluating" && (
        <div style={styles.centered}>
          <div style={styles.loader} />
          <div style={styles.loadingText}>{loadingMsg}</div>
        </div>
      )}

      {/* ── RESULT ── */}
      {screen === "result" && evaluation && (
        <div style={styles.centered}>
          <div style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((i) => (
              <StarIcon key={i} filled={i <= evaluation.score} />
            ))}
          </div>
          <div style={styles.scoreLabel}>{evaluation.score} из 5</div>
          <div style={styles.commentBox}>
            <div style={styles.commentText}>{evaluation.comment}</div>
          </div>
          <div style={styles.correctBox}>
            <div style={styles.correctLabel}>Правильный ответ:</div>
            <div style={styles.correctText}>{evaluation.correct_answer}</div>
          </div>
          <button style={styles.btnPrimary} onClick={handleNext}>
            {questionNum >= TOTAL_QUESTIONS ? "🏁 РЕЗУЛЬТАТЫ" : "➡ ДАЛЬШЕ"}
          </button>
        </div>
      )}

      {/* ── FINAL ── */}
      {screen === "final" && (
        <div style={styles.centered}>
          {(() => {
            const g = getGrade();
            return (
              <>
                <div style={styles.finalEmoji}>{g.emoji}</div>
                <div style={styles.finalTitle}>{g.text}</div>
                <div style={styles.finalSub}>{g.sub}</div>
                <div style={styles.finalStats}>
                  <div style={styles.statItem}>
                    <div style={styles.statValue}>{totalScore}</div>
                    <div style={styles.statLabel}>из {maxPossible}</div>
                  </div>
                  <div style={styles.statDivider} />
                  <div style={styles.statItem}>
                    <div style={styles.statValue}>{avgScore}</div>
                    <div style={styles.statLabel}>средний балл</div>
                  </div>
                </div>
                <div style={styles.scoresStrip}>
                  {scores.map((s, i) => (
                    <div key={i} style={{ ...styles.miniScore, background: s >= 4 ? "#4CAF50" : s >= 3 ? "#FFC107" : "#f44336" }}>
                      {s}
                    </div>
                  ))}
                </div>
                <button style={styles.btnPrimary} onClick={handleStart}>
                  🔄 ИГРАТЬ СНОВА
                </button>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Styles ──

const pixelFont = `'Courier New', 'Courier', monospace`;

const styles = {
  container: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)",
    fontFamily: pixelFont,
    color: "#e8e8e8",
    position: "relative",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  scanlines: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
    zIndex: 100,
  },
  centered: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    padding: "24px 20px",
    textAlign: "center",
  },
  title: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  titleIcon: { fontSize: 36 },
  titleMain: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: 4,
    color: "#8BC34A",
    textShadow: "2px 2px 0 #33691E, 0 0 20px rgba(139,195,74,0.4)",
  },
  titleSub: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: 8,
    color: "#FFD700",
    textShadow: "1px 1px 0 #5D4037",
  },
  subtitle: {
    fontSize: 13,
    color: "#aaa",
    marginBottom: 28,
    letterSpacing: 1,
  },
  infoBox: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 32,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    padding: "16px 24px",
    border: "1px solid rgba(139,195,74,0.2)",
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 14,
    color: "#ccc",
  },
  btnPrimary: {
    background: "linear-gradient(180deg, #4CAF50 0%, #388E3C 100%)",
    color: "#fff",
    border: "2px solid #2E7D32",
    borderBottom: "4px solid #1B5E20",
    borderRadius: 6,
    padding: "14px 32px",
    fontSize: 15,
    fontWeight: 700,
    fontFamily: pixelFont,
    letterSpacing: 2,
    cursor: "pointer",
    textShadow: "1px 1px 0 rgba(0,0,0,0.3)",
    width: "100%",
    maxWidth: 300,
  },
  playScreen: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    padding: "0 16px 24px",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    padding: "14px 4px 10px",
    borderBottom: "2px solid rgba(139,195,74,0.2)",
    marginBottom: 12,
  },
  topBarItem: {
    fontSize: 14,
    fontWeight: 700,
    color: "#8BC34A",
    letterSpacing: 1,
  },
  diffBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    color: "#aaa",
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  diffDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  questionCard: {
    background: "rgba(255,255,255,0.06)",
    border: "2px solid rgba(139,195,74,0.25)",
    borderRadius: 10,
    padding: "20px 18px",
    marginBottom: 16,
  },
  questionText: {
    fontSize: 17,
    lineHeight: 1.5,
    fontWeight: 600,
    color: "#f0f0f0",
  },
  transcriptBox: {
    background: "rgba(139,195,74,0.1)",
    border: "1px solid rgba(139,195,74,0.3)",
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 12,
  },
  transcriptLabel: {
    fontSize: 10,
    color: "#8BC34A",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  transcriptText: {
    fontSize: 15,
    color: "#e8e8e8",
    lineHeight: 1.4,
  },
  errorText: {
    fontSize: 12,
    color: "#f44336",
    marginBottom: 8,
  },
  inputArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginTop: "auto",
  },
  micBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.06)",
    border: "2px solid rgba(139,195,74,0.3)",
    borderRadius: 16,
    padding: "16px 32px",
    cursor: "pointer",
    width: "100%",
    maxWidth: 300,
    transition: "all 0.2s",
  },
  micBtnActive: {
    background: "rgba(255,0,0,0.12)",
    border: "2px solid rgba(255,68,68,0.5)",
    boxShadow: "0 0 20px rgba(255,0,0,0.2)",
  },
  micLabel: {
    fontSize: 12,
    color: "#aaa",
    letterSpacing: 1,
  },
  textInputRow: {
    width: "100%",
    maxWidth: 300,
  },
  textField: {
    width: "100%",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 6,
    padding: "10px 12px",
    color: "#e8e8e8",
    fontSize: 14,
    fontFamily: pixelFont,
    outline: "none",
    boxSizing: "border-box",
  },
  loader: {
    width: 40,
    height: 40,
    border: "4px solid rgba(139,195,74,0.2)",
    borderTop: "4px solid #8BC34A",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 14,
    color: "#8BC34A",
    letterSpacing: 1,
  },
  starsRow: {
    display: "flex",
    gap: 6,
    marginBottom: 8,
  },
  scoreLabel: {
    fontSize: 22,
    fontWeight: 900,
    color: "#FFD700",
    marginBottom: 16,
    textShadow: "0 0 10px rgba(255,215,0,0.4)",
  },
  commentBox: {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 10,
    padding: "14px 18px",
    marginBottom: 12,
    maxWidth: 320,
    border: "1px solid rgba(255,255,255,0.1)",
  },
  commentText: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "#ddd",
  },
  correctBox: {
    marginBottom: 24,
    padding: "10px 16px",
    background: "rgba(76,175,80,0.1)",
    borderRadius: 8,
    border: "1px solid rgba(76,175,80,0.25)",
    maxWidth: 320,
  },
  correctLabel: {
    fontSize: 10,
    color: "#8BC34A",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  correctText: {
    fontSize: 14,
    color: "#a5d6a7",
    fontWeight: 600,
  },
  finalEmoji: { fontSize: 56, marginBottom: 8 },
  finalTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: "#FFD700",
    marginBottom: 4,
    textShadow: "0 0 10px rgba(255,215,0,0.3)",
  },
  finalSub: {
    fontSize: 13,
    color: "#aaa",
    marginBottom: 24,
  },
  finalStats: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    marginBottom: 16,
    background: "rgba(255,255,255,0.05)",
    borderRadius: 10,
    padding: "16px 28px",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  statItem: { textAlign: "center" },
  statValue: {
    fontSize: 28,
    fontWeight: 900,
    color: "#8BC34A",
  },
  statLabel: {
    fontSize: 11,
    color: "#888",
    letterSpacing: 1,
  },
  statDivider: {
    width: 1,
    height: 36,
    background: "rgba(255,255,255,0.15)",
  },
  scoresStrip: {
    display: "flex",
    gap: 6,
    marginBottom: 24,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  miniScore: {
    width: 28,
    height: 28,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
  },
};

// inject keyframe for spinner
if (typeof document !== "undefined" && !document.getElementById("mc-quiz-styles")) {
  const s = document.createElement("style");
  s.id = "mc-quiz-styles";
  s.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(s);
}
