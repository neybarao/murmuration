// Browser checks for the v2 Ball Field lab.
// Usage: from the repo root, `node tests/ball-field-browser.cjs` (starts its own static server).
// Needs Playwright with Chromium. Headless Chromium renders WebGL in software, so frame rates here
// are not representative; the CPU time spent in our frame code is.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  if (req.url === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>blank</title>'); }
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`); if (!ok) failures++; };

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
    await page.goto(`${base}/v2/`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => setPlaying(false));
    const s = await page.evaluate(() => runtime.stats());
    check(s.backend === 'webgl2', `default backend is webgl2 (got ${s.backend})`);
    check(s.balls === 67600, `default grid draws 67,600 balls (got ${s.balls})`);
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

    // CPU cost of our frame code with the default 67,600 balls, sampled over 30 renders.
    const cpu = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 30; i++) {
        runtime.seek(i / 30);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        samples.push(runtime.stats().frameCpu);
      }
      samples.sort((a, b) => a - b);
      return { median: samples[15], p95: samples[28] };
    });
    console.log(`INFO: frame CPU median ${cpu.median.toFixed(3)} ms, p95 ${cpu.p95.toFixed(3)} ms (67,600 balls)`);
    check(cpu.median < 2, 'median frame CPU under 2 ms');

    // Something is drawn: the canvas is not a flat background.
    await page.evaluate(() => { runtime.pause(); runtime.seek(0.25); });
    await page.waitForTimeout(200);
    const shot = await page.locator('#stage canvas').screenshot();
    fs.mkdirSync(path.join(root, 'tests', 'out'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tests', 'out', 'ball-field-webgl2.png'), shot);
    check(shot.length > 20000, `preview renders visible content (${shot.length} byte PNG)`);

    // Loop closes: progress 0 and progress ~1 produce the same image.
    const same = await page.evaluate(async () => {
      const grab = async p => {
        runtime.seek(p);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const c = runtime.canvas, gl = c.getContext('webgl2');
        const px = new Uint8Array(c.width * c.height * 4);
        gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      runtime.update({ playing: false });
      const a = await grab(0), b = await grab(0.999999);
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 24) diff++;
      return diff / (a.length / 4);
    });
    check(same < 0.002, `loop end matches loop start (${(same * 100).toFixed(3)}% pixels differ)`);

    // Real mouse clicks reach the buttons that sit over the preview.
    await page.evaluate(() => setPlaying(true));
    await page.click('#playBtn');
    await page.click('#themeBtn');
    await page.click('#fullBtn');
    const clicked = await page.evaluate(() => [state.playing, theme, document.getElementById('app').classList.contains('is-full')]);
    check(clicked[0] === false && clicked[1] === 'dark' && clicked[2] === true, `Pause, Dark and Full screen respond to clicks (${clicked.join(', ')})`);
    await page.click('#fullBtn');
    await page.click('#themeBtn');

    // Effect selector: Organic loads its own preset and renders.
    await page.evaluate(() => { const i = document.getElementById('c-centerAttenuation'); i.value = 0.7; i.dispatchEvent(new Event('input')); });
    await page.selectOption('#c-effect', 'organic');
    await page.waitForTimeout(300);
    const organic = await page.evaluate(() => [state.effect, state.tilt, runtime.settings.effect, runtime.settings.centerAttenuation]);
    check(organic[0] === 'organic' && organic[1] === 55 && organic[2] === 'organic', `Organic effect loads its preset (${organic.join(', ')})`);
    check(organic[3] === 0.7, `center attenuation survives switching effect (${organic[3]})`);
    await page.selectOption('#c-effect', 'ballAction');

    // Home -> Chat: Chat fades the centre; the transition interpolates and then settles.
    await page.evaluate(() => setPlaying(false));
    await page.click('[data-screen="chat"]');
    const during = await page.evaluate(() => runtime.stats().transitioning);
    await page.waitForTimeout(1600);
    const chat = await page.evaluate(() => [runtime.activeState, runtime.settings.centerAttenuation, runtime.stats().transitioning, active]);
    check(during === true && chat[0] === 'chat' && chat[1] === 0.72 && chat[2] === false && chat[3] === 'chat', `Home to Chat transition runs and settles (${chat.join(', ')})`);
    // Cross-fade path: Chat on Organic, then back to Home.
    await page.selectOption('#c-effect', 'organic');
    await page.click('[data-screen="home"]');
    await page.waitForTimeout(600);
    const mid = await page.locator('#stage canvas').screenshot();
    fs.writeFileSync(path.join(root, 'tests', 'out', 'ball-field-crossfade.png'), mid);
    await page.waitForTimeout(1200);
    const back = await page.evaluate(() => [runtime.activeState, runtime.settings.effect, states.chat.effect]);
    check(back[0] === 'home' && back[1] === 'ballAction' && back[2] === 'organic', `cross-fade between effects settles on Home (${back.join(', ')})`);
    const specRowsDiffer = await page.evaluate(() => document.querySelectorAll('#specs tr.is-different').length);
    check(specRowsDiffer > 3, `specs table highlights rows that differ (${specRowsDiffer})`);
    await page.click('[data-screen="chat"]');
    await page.selectOption('#c-effect', 'ballAction');
    await page.click('[data-screen="home"]');
    await page.waitForTimeout(1500);

    // Share link round trip.
    await page.evaluate(() => { state.twistAngle = 123; state.gridSpacing = 7; runtime.update(state); });
    const link = await page.evaluate(() => shareUrl());
    const page2 = await browser.newPage();
    await page2.goto(link);
    await page2.waitForTimeout(500);
    const restored = await page2.evaluate(() => [state.twistAngle, state.gridSpacing, states.chat.centerAttenuation]);
    check(restored[0] === 123 && restored[1] === 7 && restored[2] === 0.72, `share link restores settings (${restored.join(', ')})`);

    // Download JS: module imports into an empty page and renders.
    const source = await page.evaluate(() => buildBallFieldModule({ states, transitionDuration }));
    const page3 = await browser.newPage();
    await page3.goto(`${base}/__blank`);
    await page3.setContent('<div id="bg" style="position:fixed;inset:0;isolation:isolate"></div>');
    const exported = await page3.evaluate(async src => {
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const mod = await import(url);
      const field = mod.createBallFieldBackground(document.getElementById('bg'));
      await new Promise(r => setTimeout(r, 300));
      const out = { backend: field.backend, twist: field.settings.twistAngle, balls: field.stats().balls, states: field.states.join('+'), toChat: field.transitionTo('chat'), noUi: !document.querySelector('button, input, select') };
      field.destroy();
      out.removed = !document.querySelector('#bg canvas');
      return out;
    }, source);
    check(exported.backend === 'webgl2' && exported.twist === 123 && exported.removed && exported.states === 'home+chat' && exported.toChat && exported.noUi, `exported module works and destroys cleanly (${JSON.stringify(exported)})`);

    // Canvas 2D fallback.
    const page4 = await browser.newPage({ viewport: { width: 960, height: 600 } });
    await page4.goto(`${base}/v2/?renderer=canvas2d`);
    await page4.waitForTimeout(800);
    const fb = await page4.evaluate(() => runtime.stats());
    check(fb.backend === 'canvas2d' && fb.drawn > 0 && fb.drawn <= 9000, `canvas2d fallback draws a capped set (${fb.drawn} of ${fb.balls})`);
    fs.writeFileSync(path.join(root, 'tests', 'out', 'ball-field-canvas2d.png'), await page4.locator('#stage canvas').screenshot());

    // Mobile layout.
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await mobile.goto(`${base}/v2/`);
    await mobile.waitForTimeout(800);
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(!overflow, 'no horizontal overflow at phone width');
    fs.writeFileSync(path.join(root, 'tests', 'out', 'ball-field-mobile.png'), await mobile.screenshot());
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
  process.exit(failures ? 1 : 0);
})();
