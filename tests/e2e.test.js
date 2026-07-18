// E2E-тест: реальный Chromium (playwright-core + системный браузер), приложение
// поднимается на локальном http-сервере, CDN-скрипты отдаются из tests/vendor/
// (качаются при первом запуске), DeepSeek API мокается через route-перехват.

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");
const assert = require("assert");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(__dirname, "vendor");
const CHROMIUM_PATH = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

const CDN_FILES = [
  {
    file: "react.production.min.js",
    npm: ["react", "umd", "react.production.min.js"],
    url: "https://unpkg.com/react@18/umd/react.production.min.js",
  },
  {
    file: "react-dom.production.min.js",
    npm: ["react-dom", "umd", "react-dom.production.min.js"],
    url: "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  },
  {
    file: "babel.min.js",
    npm: ["@babel", "standalone", "babel.min.js"],
    url: "https://unpkg.com/@babel/standalone/babel.min.js",
  },
];

function ensureVendor() {
  fs.mkdirSync(VENDOR, { recursive: true });
  for (const { file, npm, url } of CDN_FILES) {
    const dest = path.join(VENDOR, file);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 10000) continue;
    // основной путь — локальные npm-пакеты (react@18 ещё поставляет UMD-сборки),
    // curl с CDN — только запасной, если пакетов нет
    const local = path.join(__dirname, "node_modules", ...npm);
    if (fs.existsSync(local)) {
      fs.copyFileSync(local, dest);
      continue;
    }
    console.log("  ↓ качаем " + file);
    execSync(`curl -fsSL --retry 3 -o "${dest}" "${url}"`, { stdio: "inherit" });
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split("?")[0];
      const file = urlPath === "/" ? "index.html" : urlPath.slice(1);
      const full = path.join(ROOT, file);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404);
        return res.end("not found");
      }
      const type = full.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(fs.readFileSync(full));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function vendorRoute(route) {
  const url = route.request().url();
  let file = null;
  if (url.includes("react-dom")) file = "react-dom.production.min.js";
  else if (url.includes("react@18")) file = "react.production.min.js";
  else if (url.includes("babel")) file = "babel.min.js";
  if (!file) return route.abort();
  return route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: fs.readFileSync(path.join(VENDOR, file)),
  });
}

const aiChoice = (obj) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ choices: [{ message: { content: typeof obj === "string" ? obj : JSON.stringify(obj) } }] }),
});

async function scenarioWithApi(browser, base) {
  console.log("\nСценарий 1: игра с API-ключом (мок DeepSeek), вьюпорт iPhone 12 Pro");
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  const genRequests = [];
  const evalRequests = [];
  const verifyRequests = [];

  await context.addInitScript(() => localStorage.setItem("mc_quiz_api_key", "test-key-123"));
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("unpkg.com")) return vendorRoute(route);
    if (url.includes("api.deepseek.com")) {
      const body = JSON.parse(route.request().postData());
      const sys = body.messages[0].content;
      if (sys.includes("составитель вопросов")) {
        genRequests.push(body);
        const n = genRequests.length;
        return route.fulfill(aiChoice({
          question: `Тестовый вопрос №${n}?`,
          correct_answer: "Ответ " + n,
          acceptable_answers: ["вариант а", "вариант б"],
          difficulty: "easy",
        }));
      }
      if (sys.includes("факт-чекер")) {
        verifyRequests.push(body);
        // Вопрос №3 факт-чекер «исправляет»: и формулировку, и ответ
        const isQ3 = body.messages[1].content.includes("Тестовый вопрос №3?");
        return route.fulfill(aiChoice(isQ3
          ? { verdict: "fix", corrected_question: "Исправленный вопрос №3?", corrected_answer: "Исправленный ответ 3", acceptable_answers: ["новый вариант"] }
          : { verdict: "ok", acceptable_answers: ["проверенный вариант"] }));
      }
      if (sys.includes("судья")) {
        evalRequests.push(body);
        // «Несправедливый судья» для ответа «вариант а» — приложение обязано
        // поднять оценку локальной проверкой (ответ есть в acceptable_answers)
        const unfair = body.messages[1].content.includes("Ответ игрока: вариант а");
        return route.fulfill(aiChoice(unfair
          ? { score: 1, comment: "Это не то!", correct_answer: "Ответ 2" }
          : { score: 5, comment: "Отлично, шахтёр!", correct_answer: "Ответ 1" }));
      }
      return route.fulfill(aiChoice("ок"));
    }
    return route.continue();
  });

  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e));

  await page.goto(base);
  await page.getByText("DeepSeek API-ключ сохранён").waitFor({ timeout: 20000 });

  // Бейдж версии: есть, semver, не выходит за экран по горизонтали
  // и НЕ пересекается с кнопками (регресс: кнопки наползали на fixed-бейдж)
  const intersects = (a, b) => a && b &&
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
  const appVersion = await page.evaluate(() => window.__MCQUIZ_TEST__.APP_VERSION);
  assert.match(appVersion, /^\d+\.\d+\.\d+$/, "APP_VERSION не semver");
  const vp = page.viewportSize();
  const badgeBox = await page.locator(".version-tag").boundingBox();
  assert.ok(badgeBox, "у бейджа версии нет boundingBox");
  assert.ok(badgeBox.x >= 0 && badgeBox.x + badgeBox.width <= vp.width + 0.5, "бейдж выходит за экран по горизонтали");
  const startBtnBox = await page.getByText("НАЧАТЬ ИГРУ").boundingBox();
  assert.ok(!intersects(badgeBox, startBtnBox), "кнопка «НАЧАТЬ ИГРУ» наползает на бейдж версии");
  const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(hOverflow <= 0, "у страницы горизонтальный overflow: " + hOverflow + "px");

  await page.getByText("НАЧАТЬ ИГРУ").click();

  // Вопрос 1 сгенерирован через API
  await page.getByText("Тестовый вопрос №1?").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("#1/10").isVisible(), "нет счётчика вопросов");
  assert.ok(await page.getByText("Прочитать вопрос").isVisible(), "нет кнопки озвучки");
  // В игре кнопка «ОТВЕТИТЬ» прижата к низу — не должна пересекаться с бейджем (кейс со скрина)
  const badgeInGame = await page.locator(".version-tag").boundingBox();
  const answerBtnBox = await page.getByText("✓ ОТВЕТИТЬ").boundingBox();
  assert.ok(badgeInGame, "бейдж версии пропал в игре");
  assert.ok(!intersects(badgeInGame, answerBtnBox), "кнопка «ОТВЕТИТЬ» наползает на бейдж версии");

  // Единый ввод: текст попадает в блок «Твой ответ»
  await page.locator('input[placeholder="...или напиши ответ"]').fill("тестовый ответ");
  await page.getByText("Твой ответ:").waitFor({ timeout: 5000 });

  await page.getByText("✓ ОТВЕТИТЬ").click();
  await page.getByText("5 из 5").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("Отлично, шахтёр!").isVisible(), "нет комментария судьи");

  // Дальше: вопрос 2 должен быть предзагружен
  await page.getByText("ДАЛЬШЕ").click();
  await page.getByText("Тестовый вопрос №2?").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("#2/10").isVisible());
  assert.ok(await page.getByText("⭐ 5").isVisible(), "очки не начислены");

  // «Несправедливый судья»: ответ «вариант а» есть в acceptable_answers,
  // мок-судья ставит 1 — локальная «страховка» обязана поднять до 5
  await page.locator('input[placeholder="...или напиши ответ"]').fill("вариант а");
  await page.getByText("✓ ОТВЕТИТЬ").click();
  await page.getByText("5 из 5").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("Отлично!").isVisible(), "после апгрейда нет локального комментария");

  // Вопрос 3: факт-чекер переписал формулировку — на экране исправленный текст;
  // сумма очков должна учесть поднятую оценку (5+5)
  await page.getByText("ДАЛЬШЕ").click();
  await page.getByText("Исправленный вопрос №3?").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("#3/10").isVisible());
  assert.ok(await page.getByText("⭐ 10").isVisible(), "оценка-страховка не попала в сумму очков");

  await page.waitForTimeout(500); // даём уйти префетчу следующего вопроса

  // Проверки запросов генерации
  assert.ok(genRequests.length >= 2, "префетч не сработал: запросов генерации " + genRequests.length);
  const topics = [];
  for (const body of genRequests) {
    assert.strictEqual(body.temperature, 0.7, "temperature генерации ≠ 0.7");
    assert.strictEqual(body.model, "deepseek-chat");
    assert.deepStrictEqual(body.response_format, { type: "json_object" });
    assert.ok(body.messages[0].content.includes("Java Edition"), "в системном промпте нет Java Edition");
    assert.ok(body.messages[0].content.includes("Minecraft Wiki"), "в системном промпте нет Minecraft Wiki");
    const m = body.messages[1].content.match(/Тема вопроса: (.+?)\./);
    assert.ok(m, "в user-промпте нет темы");
    topics.push(m[1]);
  }
  assert.strictEqual(new Set(topics).size, topics.length, "темы повторяются: " + topics.join(", "));
  assert.ok(genRequests[1].messages[1].content.includes("Тестовый вопрос №1?"), "история вопросов не передаётся");

  // Проверки факт-чека: каждый сгенерированный вопрос проверен вторым вызовом с temperature 0
  assert.ok(verifyRequests.length >= 2, "факт-чек не запускался: " + verifyRequests.length);
  for (const body of verifyRequests) {
    assert.strictEqual(body.temperature, 0, "temperature факт-чека ≠ 0");
  }
  assert.ok(verifyRequests[0].messages[1].content.includes("Тестовый вопрос №1?"), "факт-чек проверяет не тот вопрос");

  // Проверки запросов оценки (acceptable_answers дополнены факт-чеком)
  assert.strictEqual(evalRequests.length, 2, "ожидали 2 запроса оценки");
  const ev = evalRequests[0];
  assert.strictEqual(ev.temperature, 0.2, "temperature оценки ≠ 0.2");
  assert.ok(ev.messages[1].content.includes("Допустимые варианты ответа"), "судье не передали acceptable_answers");
  assert.ok(ev.messages[1].content.includes("вариант а; вариант б; проверенный вариант"), "варианты факт-чека не домержились");
  assert.ok(ev.messages[1].content.includes("Ответ игрока: тестовый ответ"));
  assert.ok(evalRequests[1].messages[1].content.includes("Ответ игрока: вариант а"));

  // Навигация: выход на главную из игры через 🏠 с двухтаповым подтверждением
  await page.getByText("🏠", { exact: true }).click();
  await page.getByText("Выйти?").waitFor({ timeout: 5000 });
  await page.getByText("Выйти?").click();
  await page.getByText("НАЧАТЬ ИГРУ").waitFor({ timeout: 5000 });

  // Новая игра после выхода стартует с чистого листа
  await page.getByText("НАЧАТЬ ИГРУ").click();
  await page.getByText(/Тестовый вопрос №\d+\?/).waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("#1/10").isVisible(), "после выхода новая игра не с 1-го вопроса");
  assert.ok(await page.getByText("⭐ 0").isVisible(), "очки не обнулились после выхода");

  assert.deepStrictEqual(pageErrors, [], "ошибки на странице: " + pageErrors.join("; "));
  await context.close();
  console.log("  ✓ генерация с темами, префетч, оценка с acceptable_answers, выход 🏠 — OK");
}

async function scenarioFallback(browser, base) {
  console.log("\nСценарий 2: без ключа — встроенный банк, сложность «Легко», локальная оценка");
  const context = await browser.newContext();
  const pageErrors = [];
  const apiRequests = [];

  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.includes("unpkg.com")) return vendorRoute(route);
    if (url.includes("api.deepseek.com")) {
      apiRequests.push(url);
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e));

  await page.goto(base);
  await page.getByText("НАЧАТЬ ИГРУ").waitFor({ timeout: 20000 });
  await page.getByText("Легко", { exact: true }).click(); // выбор сложности
  await page.getByText("НАЧАТЬ ИГРУ").click();

  // Первый easy-вопрос из банка
  await page.getByText("Из каких блоков делается верстак?").waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="...или напиши ответ"]').fill("из четырёх досок");
  await page.getByText("✓ ОТВЕТИТЬ").click();

  // Локальная оценка: точное совпадение = 5
  await page.getByText("5 из 5").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("Отлично!").isVisible(), "нет комментария локальной оценки");

  // Второй easy-вопрос из банка
  await page.getByText("ДАЛЬШЕ").click();
  await page.getByText("Какой предмет нужен, чтобы добыть алмазную руду?").waitFor({ timeout: 20000 });

  // Навигация с экрана результата: «НА ГЛАВНУЮ» с подтверждением
  await page.locator('input[placeholder="...или напиши ответ"]').fill("железная кирка");
  await page.getByText("✓ ОТВЕТИТЬ").click();
  await page.getByText("5 из 5").waitFor({ timeout: 20000 });
  await page.getByText("НА ГЛАВНУЮ").click();
  await page.getByText("ТОЧНО ВЫЙТИ?").waitFor({ timeout: 5000 });
  await page.getByText("ТОЧНО ВЫЙТИ?").click();
  await page.getByText("НАЧАТЬ ИГРУ").waitFor({ timeout: 5000 });

  assert.strictEqual(apiRequests.length, 0, "без ключа не должно быть запросов к API, было: " + apiRequests.length);
  assert.deepStrictEqual(pageErrors, [], "ошибки на странице: " + pageErrors.join("; "));
  await context.close();
  console.log("  ✓ fallback-банк, фильтр сложности, локальный скоринг, выход с результата — OK");
}

async function main() {
  console.log("Подготовка vendor-файлов CDN...");
  ensureVendor();
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port + "/";
  console.log("Сервер: " + base);

  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    await scenarioWithApi(browser, base);
    await scenarioFallback(browser, base);
    console.log("\nE2E: OK — оба сценария прошли");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error("\nE2E: ПРОВАЛ");
  console.error(e);
  process.exit(1);
});
