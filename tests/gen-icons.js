// Генератор иконок PWA: пиксельная морда крипера, рендерится системным Chromium.
// Запуск: cd tests && npm run gen-icons (перезаписывает icon-*.png в корне репозитория).
const path = require("path");
const { chromium } = require("playwright-core");

const CHROMIUM_PATH = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";
const ROOT = path.join(__dirname, "..");
const FACE = [
  "........",
  "........",
  ".XX..XX.",
  ".XX..XX.",
  "...XX...",
  "..XXXX..",
  "..XXXX..",
  "..X..X..",
];
const SIZES = [180, 192, 512]; // 180 — apple-touch-icon, 192/512 — manifest

function iconHtml(size) {
  const cell = size / 8;
  const cells = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const face = FACE[y][x] === "X";
      const shade = (x + y) % 2 === 0 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)";
      cells.push(
        `<div style="position:absolute;left:${x * cell}px;top:${y * cell}px;` +
        `width:${cell}px;height:${cell}px;background:${face ? "#12240f" : shade}"></div>`
      );
    }
  }
  return `<body style="margin:0"><div style="position:relative;width:${size}px;height:${size}px;background:#4CAF50;overflow:hidden">${cells.join("")}</div></body>`;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(iconHtml(size));
    const out = path.join(ROOT, `icon-${size}.png`);
    await page.screenshot({ path: out });
    await page.close();
    console.log("✓ " + out);
  }
  await browser.close();
})();
