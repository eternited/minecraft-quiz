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
  test("совсем не то = 1", () => {
    const r = T.localScore("эндермен", { correct_answer: "Крипер", acceptable_answers: [] });
    assert.strictEqual(r.score, 1);
  });
  test("comment и correct_answer присутствуют", () => {
    const r = T.localScore("что-то", { correct_answer: "Крипер", acceptable_answers: [] });
    assert.ok(r.comment && r.correct_answer === "Крипер");
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
  test("APP_VERSION задана в формате semver", () => {
    assert.match(T.APP_VERSION, /^\d+\.\d+\.\d+$/);
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
