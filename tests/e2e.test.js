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
      if (sys.includes("судья")) {
        evalRequests.push(body);
        return route.fulfill(aiChoice({ score: 5, comment: "Отлично, шахтёр!", correct_answer: "Ответ 1" }));
      }
      return route.fulfill(aiChoice("ок"));
    }
    return route.continue();
  });

  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e));

  await page.goto(base);
  await page.getByText("DeepSeek API-ключ сохранён").waitFor({ timeout: 20000 });

  // Бейдж версии виден, совпадает с APP_VERSION и вписан в экран (без вылезания за края)
  const appVersion = await page.evaluate(() => window.__MCQUIZ_TEST__.APP_VERSION);
  assert.match(appVersion, /^\d+\.\d+\.\d+$/, "APP_VERSION не semver");
  assert.ok(await page.getByText("v" + appVersion, { exact: true }).isVisible(), "нет бейджа версии на старте");
  const vp = page.viewportSize();
  const box = await page.locator(".version-tag").boundingBox();
  assert.ok(box, "у бейджа версии нет boundingBox");
  assert.ok(box.x >= 0 && box.x + box.width <= vp.width + 0.5, "бейдж выходит за экран по горизонтали");
  assert.ok(box.y >= 0 && box.y + box.height <= vp.height + 0.5, "бейдж выходит за экран по вертикали");
  const hOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(hOverflow <= 0, "у страницы горизонтальный overflow: " + hOverflow + "px");

  await page.getByText("НАЧАТЬ ИГРУ").click();

  // Вопрос 1 сгенерирован через API
  await page.getByText("Тестовый вопрос №1?").waitFor({ timeout: 20000 });
  assert.ok(await page.getByText("#1/10").isVisible(), "нет счётчика вопросов");
  assert.ok(await page.getByText("Прочитать вопрос").isVisible(), "нет кнопки озвучки");
  assert.ok(await page.getByText("v" + appVersion, { exact: true }).isVisible(), "бейдж версии пропал в игре");

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

  await page.waitForTimeout(500); // даём уйти префетчу вопроса 3

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

  // Проверки запроса оценки
  assert.strictEqual(evalRequests.length, 1, "ожидали 1 запрос оценки");
  const ev = evalRequests[0];
  assert.strictEqual(ev.temperature, 0.2, "temperature оценки ≠ 0.2");
  assert.ok(ev.messages[1].content.includes("Допустимые варианты ответа"), "судье не передали acceptable_answers");
  assert.ok(ev.messages[1].content.includes("вариант а; вариант б"));
  assert.ok(ev.messages[1].content.includes("Ответ игрока: тестовый ответ"));

  assert.deepStrictEqual(pageErrors, [], "ошибки на странице: " + pageErrors.join("; "));
  await context.close();
  console.log("  ✓ генерация с темами, префетч, оценка с acceptable_answers — OK");
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

  assert.strictEqual(apiRequests.length, 0, "без ключа не должно быть запросов к API, было: " + apiRequests.length);
  assert.deepStrictEqual(pageErrors, [], "ошибки на странице: " + pageErrors.join("; "));
  await context.close();
  console.log("  ✓ fallback-банк, фильтр сложности, локальный скоринг, ноль запросов к API — OK");
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
