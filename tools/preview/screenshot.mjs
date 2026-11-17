// Скриншоты всех разделов интерфейса в режиме предпросмотра + сбор ошибок консоли.
//   NODE_PATH=... node tools/preview/screenshot.mjs <url> <outdir>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] ?? 'http://127.0.0.1:8765/index.html';
const out = process.argv[3] ?? 'shots';
const sections = (process.env.SECTIONS ?? 'home,devices,reference,switches,linux,favorites,scenarios,diagnostics,history,backups,settings,sessions').split(',');
const theme = process.env.THEME ?? 'dark';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
for (const s of sections) {
  await page.goto(`${base}?section=${s}&theme=${theme}`);
  await page.waitForFunction(() => window.__nadReady === true, null, { timeout: 15000 }).catch(() => errors.push(`[timeout] ${s}: приложение не сообщило о готовности`));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${theme}-${s}.png` });
}
console.log(errors.length ? errors.join('\n') : 'Ошибок консоли нет');
await browser.close();
