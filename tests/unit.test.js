// Юнит-тесты чистой логики index.html.
// Скрипт страницы транспилируется Babel'ем и выполняется в Node VM с заглушками
// React/ReactDOM/localStorage — компонент не рендерится, тестируем window.__MCQUIZ_TEST__.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const Babel = require("@babel/standalone");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const match = html.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
if (!match) {
  console.error("Не найден <script type=\"text/babel\"> в index.html");
  process.exit(1);
}
const { code } = Babel.transform(match[1], { presets: ["react"] });

function makeContext() {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const React = {
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useCallback: (f) => f,
    createElement: () => null,
    Fragment: {},
  };
  const ReactDOM = { createRoot: () => ({ render: () => {} }) };
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    DOMException,
    React,
    ReactDOM,
    localStorage,
    document: { getElementById: () => ({}) },
    navigator: {},
    fetch: () => { throw new Error("fetch не застаблен в этом тесте"); },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

let passed = 0;
const failures = [];
// Объекты из VM-контекста имеют чужие прототипы — deepStrictEqual на них
// падает с «not reference-equal», поэтому сравниваем через JSON-нормализацию.
const jeq = (actual, expected, msg) =>
  assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, msg);
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failures.push({ name, e });
    console.log("  ✗ " + name + " — " + e.message);
  }
}
async function atest(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failures.push({ name, e });
    console.log("  ✗ " + name + " — " + e.message);
  }
}

async function main() {
  const ctx = makeContext();
  const T = ctx.__MCQUIZ_TEST__;
  assert.ok(T, "window.__MCQUIZ_TEST__ должен быть определён");

  console.log("\nparseJSON:");
  test("парсит чистый JSON", () => {
    jeq(T.parseJSON('{"a":1}'), { a: 1 });
  });
  test("срезает markdown-фенсы ```json", () => {
    jeq(T.parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  });
  test("вытаскивает JSON из окружающего текста", () => {
    jeq(T.parseJSON('Вот ответ: {"a":1} — надеюсь, подойдёт'), { a: 1 });
  });
  test("кидает ошибку на мусоре", () => {
    assert.throws(() => T.parseJSON("просто текст без json"));
  });

  console.log("\ncorrectMinecraftTerms:");
  test("ридстон → редстоун", () => {
    assert.strictEqual(T.correctMinecraftTerms("ридстон"), "редстоун");
  });
  test("криппер → крипер, пиглен → пиглин", () => {
    assert.strictEqual(T.correctMinecraftTerms("криппер и пиглен"), "крипер и пиглин");
  });
  test("апсидиан → обсидиан, вайзер → визер", () => {
    assert.strictEqual(T.correctMinecraftTerms("апсидиан вайзер"), "обсидиан визер");
  });
  test("«призрак» больше не подменяется на «фантом»", () => {
    assert.strictEqual(T.correctMinecraftTerms("призрак"), "призрак");
  });
  test("газт → гаст, слаим → слайм", () => {
    assert.strictEqual(T.correctMinecraftTerms("газт слаим"), "гаст слайм");
  });
  test("нет правил-пустышек (замена сама на себя тем же регистром)", () => {
    for (const [pattern, repl] of T.RAW_CORRECTIONS) {
      // если паттерн — буквальная строка без классов/квантификаторов и равен замене, это no-op
      if (!/[\[\]?*+()|\\]/.test(pattern)) {
        assert.notStrictEqual(pattern, repl, `правило-пустышка: ${pattern} → ${repl}`);
      }
    }
  });
  test("границы слов работают: термин внутри слова не трогаем", () => {
    // отдельное «ноч» исправляется на «нотч», «ноч» внутри «виночерпий» — нет
    assert.strictEqual(T.correctMinecraftTerms("уже ноч на дворе"), "уже нотч на дворе");
    assert.strictEqual(T.correctMinecraftTerms("виночерпий"), "виночерпий");
  });

  console.log("\nlocalScore:");
  test("точное совпадение = 5", () => {
    const r = T.localScore("Крипер", { correct_answer: "крипер", acceptable_answers: [] });
    assert.strictEqual(r.score, 5);
  });
  test("ё/е нормализуются (зелёный = зеленый)", () => {
    const r = T.localScore("зеленый краситель", { correct_answer: "Зелёный краситель", acceptable_answers: [] });
    assert.strictEqual(r.score, 5);
  });
  test("все значимые слова, включая числа = 4 (регресс: «Минимум 10 блоков»)", () => {
    const r = T.localScore("нужно минимум 10 блоков", { correct_answer: "Минимум 10 блоков", acceptable_answers: [] });
    assert.strictEqual(r.score, 4);
  });
  test("неверное число не совпадает (12 ≠ 10) → 3 за частичное", () => {
    const r = T.localScore("минимум 12 блоков", { correct_answer: "Минимум 10 блоков", acceptable_answers: [] });
    assert.strictEqual(r.score, 3);
  });
  test("acceptable_answers: точное совпадение с вариантом = 5", () => {
    const q = { correct_answer: "Минимум 10 блоков", acceptable_answers: ["10", "минимум 10", "десять"] };
    assert.strictEqual(T.localScore("десять", q).score, 5);
    assert.strictEqual(T.localScore("10", q).score, 5);
  });
  test("падежи ловятся стеммингом («редстоуновая руда» ≈ «из редстоуновой руды»)", () => {
    const r = T.localScore("редстоуновая руда", { correct_answer: "Из редстоуновой руды", acceptable_answers: [] });
    assert.ok(r.score >= 4, "ожидали ≥4, получили " + r.score);
  });
  test("огрехи ASR в окончаниях = 5 (кейс со скрина: «Шелковая касание»)", () => {
    const r = T.localScore("Шелковая касание", { correct_answer: "Шёлковое касание", acceptable_answers: [] });
    assert.strictEqual(r.score, 5, "расхождение только в окончании должно давать 5");
  });
  test("лишние значимые слова в ответе — по-прежнему 4, а не 5", () => {
    const r = T.localScore("наверное это шелковое касание кирки", { correct_answer: "Шёлковое касание", acceptable_answers: [] });
    assert.strictEqual(r.score, 4);
  });
  test("совсем не то = 1", () => {
    const r = T.localScore("эндермен", { correct_answer: "Крипер", acceptable_answers: [] });
    assert.strictEqual(r.score, 1);
  });
  test("comment и correct_answer присутствуют", () => {
    const r = T.localScore("что-то", { correct_answer: "Крипер", acceptable_answers: [] });
    assert.ok(r.comment && r.correct_answer === "Крипер");
  });

  console.log("\nСинонимы локализации и «страховка» оценки:");
  test("«незерак» = «Адский камень» → 5 (кейс из жалобы)", () => {
    const r = T.localScore("незерак", { correct_answer: "Адский камень", acceptable_answers: [] });
    assert.strictEqual(r.score, 5);
  });
  test("«адский камень» = «Незерак» → 5 (обратное направление)", () => {
    const r = T.localScore("адский камень", { correct_answer: "Незерак", acceptable_answers: [] });
    assert.strictEqual(r.score, 5);
  });
  test("«эндерняк» = «Камень Края», «иссушитель» = «Визер» → 5", () => {
    assert.strictEqual(T.localScore("эндерняк", { correct_answer: "Камень Края", acceptable_answers: [] }).score, 5);
    assert.strictEqual(T.localScore("иссушитель", { correct_answer: "Визер", acceptable_answers: [] }).score, 5);
  });
  test("синонимы работают и через acceptable_answers", () => {
    const q = { correct_answer: "Что-то другое", acceptable_answers: ["камень Края"] };
    assert.strictEqual(T.localScore("эндерняк", q).score, 5);
  });
  test("несвязанные ответы синонимами не склеиваются", () => {
    assert.strictEqual(T.localScore("незерак", { correct_answer: "Камень Края", acceptable_answers: [] }).score, 1);
  });
  test("MC_SYNONYMS: каждая группа ≥2 названий", () => {
    assert.ok(T.MC_SYNONYMS.length >= 5);
    for (const g of T.MC_SYNONYMS) assert.ok(Array.isArray(g) && g.length >= 2);
  });
  test("mergeEvaluations: локальная 5 бьёт судейскую 1; высокая судейская остаётся; без судьи — локальная", () => {
    const local5 = { score: 5, comment: "Отлично!", correct_answer: "О" };
    const judge1 = { score: 1, comment: "Не то", correct_answer: "О" };
    const judge5 = { score: 5, comment: "Верно", correct_answer: "О" };
    assert.strictEqual(T.mergeEvaluations(judge1, local5), local5);
    assert.strictEqual(T.mergeEvaluations(judge5, { score: 4, comment: "x", correct_answer: "О" }), judge5);
    assert.strictEqual(T.mergeEvaluations(null, local5), local5);
  });

  console.log("\ncreateTopicQueue:");
  test("12 тем без повторов до исчерпания, потом новый цикл", () => {
    let s = 42;
    const rng = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const q = T.createTopicQueue(T.TOPICS, rng);
    const first = Array.from({ length: T.TOPICS.length }, () => q.next());
    assert.strictEqual(new Set(first).size, T.TOPICS.length, "повторы внутри цикла");
    assert.deepStrictEqual(new Set(first), new Set(T.TOPICS), "не все темы использованы");
    const second = Array.from({ length: T.TOPICS.length }, () => q.next());
    assert.deepStrictEqual(new Set(second), new Set(T.TOPICS), "второй цикл неполный");
  });
  test("reset начинает новый цикл", () => {
    const q = T.createTopicQueue(["а", "б", "в"]);
    q.next();
    q.reset();
    const all = [q.next(), q.next(), q.next()];
    assert.deepStrictEqual(new Set(all), new Set(["а", "б", "в"]));
  });
  test("в приложении ровно 12 тем", () => {
    assert.strictEqual(T.TOPICS.length, 12);
    assert.ok(T.TOPICS.includes("зельеварение") && T.TOPICS.includes("редстоун") && T.TOPICS.includes("Нижний мир"));
  });

  console.log("\nnormalizeQuestion:");
  test("валидный вопрос проходит и обрезается", () => {
    const q = T.normalizeQuestion({ question: " В? ", correct_answer: " О ", difficulty: "hard", acceptable_answers: [" а ", "", 5, "б"] });
    jeq(q, { question: "В?", correct_answer: "О", difficulty: "hard", acceptable_answers: ["а", "б"] });
  });
  test("без question/correct_answer → null", () => {
    assert.strictEqual(T.normalizeQuestion({ question: "В?" }), null);
    assert.strictEqual(T.normalizeQuestion(null), null);
  });
  test("кривая сложность → medium, кривой acceptable_answers → []", () => {
    const q = T.normalizeQuestion({ question: "В?", correct_answer: "О", difficulty: "expert", acceptable_answers: "нет" });
    assert.strictEqual(q.difficulty, "medium");
    jeq(q.acceptable_answers, []);
  });

  console.log("\npickFallbackQuestion:");
  test("фильтр по сложности отдаёт только её", () => {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(T.pickFallbackQuestion(i, "easy").difficulty, "easy");
      assert.strictEqual(T.pickFallbackQuestion(i, "hard").difficulty, "hard");
    }
  });
  test("mixed циклится по всему банку", () => {
    const n = T.FALLBACK_QUESTIONS.length;
    assert.strictEqual(T.pickFallbackQuestion(0, "mixed"), T.FALLBACK_QUESTIONS[0]);
    assert.strictEqual(T.pickFallbackQuestion(n, "mixed"), T.FALLBACK_QUESTIONS[0]);
    assert.strictEqual(T.pickFallbackQuestion(1, "mixed"), T.FALLBACK_QUESTIONS[1]);
  });

  console.log("\nБанк FALLBACK_QUESTIONS:");
  test("15 уникальных валидных вопросов", () => {
    assert.strictEqual(T.FALLBACK_QUESTIONS.length, 15);
    const qs = T.FALLBACK_QUESTIONS.map((q) => q.question);
    assert.strictEqual(new Set(qs).size, 15, "есть дубли");
    for (const q of T.FALLBACK_QUESTIONS) {
      assert.ok(T.normalizeQuestion(q), "невалидный вопрос: " + q.question);
    }
  });
  test("у каждого вопроса 2–4 acceptable_answers", () => {
    for (const q of T.FALLBACK_QUESTIONS) {
      assert.ok(
        Array.isArray(q.acceptable_answers) && q.acceptable_answers.length >= 2 && q.acceptable_answers.length <= 4,
        q.question + ": " + JSON.stringify(q.acceptable_answers)
      );
    }
  });
  test("представлены все три сложности", () => {
    const d = new Set(T.FALLBACK_QUESTIONS.map((q) => q.difficulty));
    assert.deepStrictEqual(d, new Set(["easy", "medium", "hard"]));
  });

  console.log("\nПромпты:");
  test("системный промпт генерации: роль, wiki, локализация, самопроверка, acceptable_answers", () => {
    const p = T.QUESTION_SYSTEM_PROMPT;
    assert.ok(p.includes("Java Edition"), "нет Java Edition");
    assert.ok(p.includes("Minecraft Wiki"), "нет Minecraft Wiki");
    assert.ok(p.includes("общепризнанный ответ"), "нет самопроверки");
    assert.ok(p.includes("acceptable_answers"), "нет acceptable_answers");
    assert.ok(p.includes("Нижний мир") && p.includes("Край") && p.includes("редстоун"), "нет официальной локализации");
  });
  test("в системном промпте 6 few-shot примеров, все валидные, сложности easy/medium/hard", () => {
    assert.strictEqual(T.QUESTION_EXAMPLES.length, 6);
    const diffs = new Set();
    for (const ex of T.QUESTION_EXAMPLES) {
      const n = T.normalizeQuestion(ex);
      assert.ok(n, "невалидный пример: " + JSON.stringify(ex));
      assert.ok(ex.acceptable_answers.length >= 2 && ex.acceptable_answers.length <= 4);
      diffs.add(ex.difficulty);
      assert.ok(T.QUESTION_SYSTEM_PROMPT.includes(JSON.stringify(ex)), "пример не попал в промпт");
    }
    assert.deepStrictEqual(diffs, new Set(["easy", "medium", "hard"]));
  });
  test("user-промпт генерации: тема, история, сложность", () => {
    const p = T.buildQuestionUserPrompt("редстоун", ["Вопрос один?", "Вопрос два?"], "hard");
    assert.ok(p.includes("Тема вопроса: редстоун"));
    assert.ok(p.includes("- Вопрос один?") && p.includes("- Вопрос два?"));
    assert.ok(p.includes("строго hard"));
  });
  test("user-промпт: пустая история → «пока нет», mixed → выбор модели", () => {
    const p = T.buildQuestionUserPrompt("Край", [], "mixed");
    assert.ok(p.includes("пока нет"));
    assert.ok(p.includes("сам выбери"));
  });
  test("промпт оценки содержит acceptable_answers", () => {
    const q = { question: "В?", correct_answer: "Крипер", acceptable_answers: ["крипер", "криппер"] };
    const p = T.buildEvalUserPrompt(q, "мой ответ");
    assert.ok(p.includes("Допустимые варианты ответа"));
    assert.ok(p.includes("крипер; криппер"));
    assert.ok(p.includes("Ответ игрока: мой ответ"));
  });
  test("промпт оценки без acceptable_answers не содержит блока вариантов", () => {
    const p = T.buildEvalUserPrompt({ question: "В?", correct_answer: "О", acceptable_answers: [] }, "х");
    assert.ok(!p.includes("Допустимые варианты"));
  });
  test("судья инструктирован прощать окончания/род/падеж (огрехи ASR)", () => {
    assert.ok(/окончани/.test(T.EVAL_SYSTEM_PROMPT), "в системном промпте судьи нет правила про окончания");
    assert.ok(/ПОЛНОЕ совпадение/.test(T.EVAL_SYSTEM_PROMPT));
    const p = T.buildEvalUserPrompt({ question: "В?", correct_answer: "О", acceptable_answers: [] }, "х");
    assert.ok(/окончания и падежи неточностью НЕ считаются/.test(p), "в шкале нет оговорки про окончания");
  });

  console.log("\nФакт-чек вопросов:");
  test("системный промпт проверяющего: вердикты, измерения, Java Edition", () => {
    const p = T.VERIFY_SYSTEM_PROMPT;
    assert.ok(p.includes("Java Edition"));
    assert.ok(p.includes("verdict") && p.includes("reject") && p.includes("corrected_answer"));
    assert.ok(p.includes("Нижний мир") && p.includes("Кра"), "нет правила про измерения");
    assert.ok(p.includes("эндерняк") && p.includes("незерак"), "нет примеров старых/разговорных названий");
  });
  test("температура факт-чека = 0", () => {
    assert.strictEqual(T.VERIFY_TEMPERATURE, 0);
  });
  test("buildVerifyUserPrompt содержит вопрос, ответ и варианты", () => {
    const p = T.buildVerifyUserPrompt({ question: "В?", correct_answer: "Камень Края", acceptable_answers: ["эндерняк"] });
    assert.ok(p.includes("Вопрос: В?"));
    assert.ok(p.includes("Заявленный правильный ответ: Камень Края"));
    assert.ok(p.includes("эндерняк"));
  });
  test("applyVerification: ok дополняет варианты без дублей (ё/регистр)", () => {
    const q = { question: "В?", correct_answer: "Камень Края", difficulty: "easy", acceptable_answers: ["камень края"] };
    const out = T.applyVerification(q, { verdict: "ok", acceptable_answers: ["эндерняк", "Камень Края"] });
    jeq(out.acceptable_answers, ["камень края", "эндерняк"]);
    assert.strictEqual(out.correct_answer, "Камень Края");
  });
  test("applyVerification: fix заменяет ответ, неверный старый не тащит в допустимые", () => {
    const q = { question: "Коренной блок острова в Крае?", correct_answer: "Адский камень", difficulty: "easy", acceptable_answers: ["адский камень"] };
    const out = T.applyVerification(q, { verdict: "fix", corrected_answer: "Камень Края", acceptable_answers: ["эндерняк", "end stone"] });
    assert.strictEqual(out.correct_answer, "Камень Края");
    assert.strictEqual(out.question, "Коренной блок острова в Крае?");
    jeq(out.acceptable_answers, ["эндерняк", "end stone"]);
  });
  test("applyVerification: corrected_question переписывает устаревшую формулировку", () => {
    const q = { question: "Что нужно для чародейского стола?", correct_answer: "Книга", difficulty: "medium", acceptable_answers: ["книга"] };
    const fixed = T.applyVerification(q, {
      verdict: "fix",
      corrected_question: "Какие предметы нужны для крафта стола зачарований?",
      corrected_answer: "Книга, алмазы и обсидиан",
      acceptable_answers: ["книга", "алмаз", "обсидиан"],
    });
    assert.strictEqual(fixed.question, "Какие предметы нужны для крафта стола зачарований?");
    assert.strictEqual(fixed.correct_answer, "Книга, алмазы и обсидиан");
    jeq(fixed.acceptable_answers, ["книга", "алмаз", "обсидиан"]);
    // corrected_question работает и при verdict ok; пустая строка игнорируется
    const okFixed = T.applyVerification(q, { verdict: "ok", corrected_question: "Новый текст?", acceptable_answers: [] });
    assert.strictEqual(okFixed.question, "Новый текст?");
    const noFix = T.applyVerification(q, { verdict: "ok", corrected_question: "  ", acceptable_answers: [] });
    assert.strictEqual(noFix.question, "Что нужно для чародейского стола?");
  });
  test("applyVerification: reject → null, мусорный вердикт → вопрос как есть", () => {
    const q = { question: "В?", correct_answer: "О", difficulty: "easy", acceptable_answers: [] };
    assert.strictEqual(T.applyVerification(q, { verdict: "reject", reason: "выдумка" }), null);
    jeq(T.applyVerification(q, null), { question: "В?", correct_answer: "О", difficulty: "easy", acceptable_answers: [] });
    jeq(T.applyVerification(q, "мусор"), { question: "В?", correct_answer: "О", difficulty: "easy", acceptable_answers: [] });
  });
  test("генерация: промпт запрещает смешивать измерения и просит старые названия", () => {
    assert.ok(T.QUESTION_SYSTEM_PROMPT.includes("Нижний мир ≠ Край"));
    assert.ok(T.QUESTION_SYSTEM_PROMPT.includes("эндерняк"));
  });
  test("генерация: только актуальная локализация с анти-примерами", () => {
    assert.ok(/актуальную официальную русскую локализацию/.test(T.QUESTION_SYSTEM_PROMPT));
    assert.ok(T.QUESTION_SYSTEM_PROMPT.includes("чародейский стол"), "нет анти-примера про стол зачарований");
  });
  test("генерация: правило про несколько верных ответов (рецепты)", () => {
    assert.ok(/верных ответов несколько/.test(T.QUESTION_SYSTEM_PROMPT));
    assert.ok(/КАЖДЫЙ верный ответ/.test(T.QUESTION_SYSTEM_PROMPT));
  });
  test("факт-чекер: проверка локализации и равноправных ответов, corrected_question в формате", () => {
    assert.ok(/актуальной официальной русской локализации/.test(T.VERIFY_SYSTEM_PROMPT));
    assert.ok(T.VERIFY_SYSTEM_PROMPT.includes("чародейский стол"));
    assert.ok(T.VERIFY_SYSTEM_PROMPT.includes("corrected_question"));
    assert.ok(/верных ответов несколько/.test(T.VERIFY_SYSTEM_PROMPT));
  });
  test("судья вправе исправить неверный эталонный ответ", () => {
    assert.ok(/противоречит вопросу или фактам игры/.test(T.EVAL_SYSTEM_PROMPT));
  });
  test("судья засчитывает любой из равноправных верных ответов", () => {
    assert.ok(/несколько верных ответов/.test(T.EVAL_SYSTEM_PROMPT));
    assert.ok(/ЛЮБОЙ/.test(T.EVAL_SYSTEM_PROMPT));
  });
  test("синоним «чародейский стол» = «стол зачарований» → 5", () => {
    const r = T.localScore("чародейский стол", { correct_answer: "Стол зачарований", acceptable_answers: [] });
    assert.strictEqual(r.score, 5);
  });

  console.log("\ncallAI:");
  await atest("шлёт temperature, model, json-режим и Bearer-ключ", async () => {
    let captured = null;
    ctx.fetch = (url, opts) => {
      captured = { url, opts };
      return Promise.resolve({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"x":1}' } }] }),
      });
    };
    const out = await T.callAI("key123", "sys", "usr", { temperature: 0.2 });
    assert.strictEqual(out, '{"x":1}');
    assert.strictEqual(captured.url, T.API_URL);
    const body = JSON.parse(captured.opts.body);
    assert.strictEqual(body.temperature, 0.2);
    assert.strictEqual(body.model, T.MODEL);
    assert.deepStrictEqual(body.response_format, { type: "json_object" });
    assert.strictEqual(body.messages[0].role, "system");
    assert.strictEqual(body.messages[1].role, "user");
    assert.strictEqual(captured.opts.headers["Authorization"], "Bearer key123");
    assert.ok(captured.opts.signal, "нет AbortSignal");
  });
  await atest("json:false не добавляет response_format", async () => {
    let body = null;
    ctx.fetch = (url, opts) => {
      body = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: "ок" } }] }) });
    };
    await T.callAI("k", "s", "u", { json: false });
    assert.strictEqual(body.response_format, undefined);
  });
  await atest("таймаут обрывает зависший запрос", async () => {
    ctx.fetch = (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    await assert.rejects(T.callAI("k", "s", "u", { timeoutMs: 30 }), /Abort/i);
  });
  await atest("не-200 → ошибка со статусом", async () => {
    ctx.fetch = () => Promise.resolve({ ok: false, status: 401 });
    await assert.rejects(T.callAI("k", "s", "u"), /API error 401/);
  });
  test("температуры по ТЗ: 0.7 генерация, 0.2 оценка", () => {
    assert.strictEqual(T.GEN_TEMPERATURE, 0.7);
    assert.strictEqual(T.EVAL_TEMPERATURE, 0.2);
    assert.strictEqual(T.API_TIMEOUT_MS, 15000);
  });

  console.log("\nВерсия приложения:");
  test("APP_VERSION в формате даты выкладки ГГГГ-ММ-ДД.N", () => {
    assert.match(T.APP_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  console.log("\nСамообновление — чистая логика:");
  test("normalizeEtag: срезает слабый префикс W/, пустое → null", () => {
    assert.strictEqual(T.normalizeEtag('W/"abc"'), '"abc"');
    assert.strictEqual(T.normalizeEtag('"abc"'), '"abc"');
    assert.strictEqual(T.normalizeEtag(null), null);
    assert.strictEqual(T.normalizeEtag(undefined), null);
  });
  test("updateAction: нет обновления / уже обновляемся / пусто → none", () => {
    assert.strictEqual(T.updateAction(null), "none");
    assert.strictEqual(T.updateAction({ available: false, ctx: "auto" }), "none");
    assert.strictEqual(T.updateAction({ available: true, updating: true, ctx: "auto" }), "none");
  });
  test("updateAction: hide → none (не мешать игре)", () => {
    assert.strictEqual(T.updateAction({ available: true, ctx: "hide" }), "none");
  });
  test("updateAction: banner-контекст → banner", () => {
    assert.strictEqual(T.updateAction({ available: true, ctx: "banner" }), "banner");
  });
  test("updateAction: чистый auto → auto (в т.ч. когда защиты истекли)", () => {
    assert.strictEqual(T.updateAction({ available: true, ctx: "auto", sinceFailMs: null, sinceAutoMs: null }), "auto");
    assert.strictEqual(T.updateAction({ available: true, ctx: "auto", sinceFailMs: 61000, sinceAutoMs: 121000 }), "auto");
  });
  test("updateAction: защита от циклов — недавний провал или автообновление → banner", () => {
    assert.strictEqual(T.updateAction({ available: true, ctx: "auto", sinceFailMs: 59000, sinceAutoMs: null }), "banner");
    assert.strictEqual(T.updateAction({ available: true, ctx: "auto", sinceFailMs: null, sinceAutoMs: 119000 }), "banner");
  });

  console.log("\nИстория результатов:");
  test("save/load: новые сверху, лимит 20, bestTotal", () => {
    for (let i = 1; i <= 25; i++) {
      T.saveGameResult({ date: "2026-07-17", total: i, scores: [], difficulty: "mixed" });
    }
    const h = T.loadHistory();
    assert.strictEqual(h.length, 20, "лимит не сработал");
    assert.strictEqual(h[0].total, 25, "новая запись не сверху");
    assert.strictEqual(T.bestTotal(h), 25);
  });
  test("битый JSON в localStorage → пустая история", () => {
    ctx.localStorage.setItem("mc_quiz_history", "{битый json");
    jeq(T.loadHistory(), []);
  });

  // ── Service Worker (sw.js) в VM ──

  const swCode = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  function makeSwContext() {
    const puts = [];
    const store = new Map();
    const cacheObj = {
      put: (k, r) => { puts.push(k); store.set(k, r); return Promise.resolve(); },
      match: (k) => Promise.resolve(store.get(k)),
      addAll: () => Promise.resolve(),
    };
    const handlers = {};
    const sandbox = {
      setTimeout, clearTimeout, URL, console,
      caches: {
        open: () => Promise.resolve(cacheObj),
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        match: (k) => cacheObj.match(k),
      },
      fetch: () => Promise.reject(new Error("fetch не застаблен")),
      Response: class { constructor(body, init) { this.body = body; this.status = (init && init.status) || 200; } },
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.addEventListener = (t, f) => { handlers[t] = f; };
    sandbox.skipWaiting = () => Promise.resolve();
    sandbox.clients = { claim: () => Promise.resolve() };
    sandbox.location = { origin: "https://t.local" };
    sandbox.registration = { scope: "https://t.local/" };
    vm.createContext(sandbox);
    vm.runInContext(swCode, sandbox);
    return { handlers, puts, store, sandbox };
  }

  console.log("\nService Worker (sw.js в VM):");
  await atest("refresh-shell обновляет ОБА ключа и подтверждает только после записи", async () => {
    const { handlers, puts, sandbox } = makeSwContext();
    sandbox.fetch = () => Promise.resolve({ status: 200, clone() { return this; } });
    const msg = await new Promise((res) => {
      handlers.message({ data: { type: "refresh-shell" }, ports: [{ postMessage: res }] });
    });
    assert.strictEqual(msg.ok, true);
    assert.deepStrictEqual(puts, ["./index.html", "."], "должны обновиться оба ключа оболочки (грабля №1)");
  });
  await atest("refresh-shell: сбой сети → ok:false, кэш не тронут", async () => {
    const { handlers, puts, sandbox } = makeSwContext();
    sandbox.fetch = () => Promise.reject(new Error("net down"));
    const msg = await new Promise((res) => {
      handlers.message({ data: { type: "refresh-shell" }, ports: [{ postMessage: res }] });
    });
    assert.strictEqual(msg.ok, false);
    assert.deepStrictEqual(puts, []);
  });
  await atest("refresh-shell: не-200 → ok:false", async () => {
    const { handlers, sandbox } = makeSwContext();
    sandbox.fetch = () => Promise.resolve({ status: 500, clone() { return this; } });
    const msg = await new Promise((res) => {
      handlers.message({ data: { type: "refresh-shell" }, ports: [{ postMessage: res }] });
    });
    assert.strictEqual(msg.ok, false);
  });
  test("HEAD не перехватывается fetch-обработчиком (проверка версии идёт мимо SW)", () => {
    const { handlers } = makeSwContext();
    let responded = false;
    handlers.fetch({ request: { method: "HEAD", url: "https://t.local/index.html" }, respondWith: () => { responded = true; } });
    assert.strictEqual(responded, false);
  });

  console.log("");
  if (failures.length) {
    console.error(`UNIT: ПРОВАЛ — ${failures.length} из ${passed + failures.length}`);
    process.exit(1);
  }
  console.log(`UNIT: OK — ${passed} тестов прошло`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
