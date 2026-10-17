// Smoke test: boot the built game in headless Chromium, go title -> menu -> 1P vs COM ->
// character select -> fight, let the CPU fight for a while and check that HP dropped and
// no script errors were reported.
//   usage: node smoke.js [path/to/dist/index.html | http://url] [screenshot dir]
// Root frames: 9 title, 12 menu, 13 mode, 14 character select, 24 fight.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const target = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
const url = /^https?:/.test(target) ? target : 'file://' + path.resolve(target);
const shots = process.argv[3] || path.join(__dirname, 'out');

const state = () => {
  const m = KOF.$.m, R = KOF.root, p1 = m(R, 'P1_role'), p2 = m(R, 'P2_role');
  return { frame: R.__d.frame, round: R.roundNum, control: m(p1, 'control'), l1: m(p1, 'life'), l2: m(p2, 'life'),
    max: m(p1, 'life_max'), timer: m(m(m(m(R, 'life_power_mc'), 'time_mc'), 'time_txt'), 'text'), err: KOF.errCount || 0 };
};

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: 660, height: 485 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('[as2 error]')) errors.push(m.text()); });
  const until = (fn, ms = 60000) => page.waitForFunction(fn, null, { timeout: ms });
  const frame = (n, ms) => until(`KOF.root && KOF.root.__d.frame == ${n}`, ms);
  const press = async (k) => { await page.keyboard.down(k); await page.waitForTimeout(80); await page.keyboard.up(k); };
  const step = (s) => console.log('-', s);
  let ok = false;
  try {
    await page.goto(url);
    step('loading assets');
    await until(() => document.getElementById('start').style.display === 'block', 180000);
    await page.evaluate(() => KOF.begin());
    await until(() => KOF.running);
    step('waiting for title'); await frame(9, 120000);
    await page.screenshot({ path: path.join(shots, '1-title.png') });
    await page.waitForTimeout(300); await page.mouse.click(329, 418); await page.waitForTimeout(500); await press('Enter');
    step('menu'); await frame(12); await page.waitForTimeout(1500); await press('Enter');
    step('mode select'); await frame(13); await page.waitForTimeout(1500); await press('j');
    step('character select'); await frame(14); await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(shots, '2-select.png') });
    for (let i = 0; i < 3; i++) { await press('j'); await page.waitForTimeout(1500); }
    step('fight'); await frame(24, 90000);
    await until(() => KOF.$.m(KOF.$.m(KOF.root, 'P1_role'), 'control') === true, 30000);
    // the CPU attacks on its own; give it time to land hits
    await page.waitForTimeout(15000);
    const s = await page.evaluate(state);
    await page.screenshot({ path: path.join(shots, '3-fight.png') });
    console.log(JSON.stringify(s));
    ok = s.frame === 24 && (s.l1 < s.max || s.l2 < s.max) && s.err === 0 && errors.length === 0;
  } catch (e) {
    console.log('FAILED:', e.message);
    try { console.log(JSON.stringify(await page.evaluate(state))); } catch (_) { }
  }
  if (errors.length) console.log('errors:\n  ' + errors.slice(0, 20).join('\n  '));
  console.log(ok ? 'PASS: fight running, HP dropped, no script errors' : 'FAIL');
  console.log('screenshots in ' + shots);
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
