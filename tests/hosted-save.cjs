// Hosted page: saving settings into the page and reopening it must restore them, repeatedly.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmuration-hosted-'));
const url = 'https://claude.ai/artifact/EXAMPLE';
const built = path.join(dir, 'index.html');
execFileSync('node', [path.join(__dirname, '..', 'tools', 'build-artifact.cjs'), url, built]);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined, channel: process.env.CHROME_BIN ? undefined : 'chrome', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    let html = fs.readFileSync(built, 'utf8');
    const errors = [];
    const stub = `window.__published = []; window.__copied = [];
      window.claude = { use: async name => name === 'artifact' ? { publish: async doc => { window.__published.push(doc); } } : null };
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__copied.push(text); } } });`;
    for (let round = 1; round <= 3; round++) {
      const page = await browser.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(stub);
      await page.route('http://hosted.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://hosted.test/page.html');
      await page.waitForTimeout(400);
      if (round === 1) {
        assert.equal(await page.evaluate(() => sharedPreviewState().states.information.shape), 'ridge', 'fresh page uses defaults');
      } else {
        const state = await page.evaluate(() => sharedPreviewState());
        assert.equal(state.states.response.shape, 'spiral', `round ${round}: Chat shape restored`);
        assert.equal(state.states.information.shape, 'wave', `round ${round}: Home shape restored`);
        assert.equal(state.states.response.colors.dark.particleColor, '#abcdef');
        assert.equal(state.states.information.colors.light.backgroundColor, '#fafafa');
        assert.equal(state.theme, 'dark');
        assert.equal(state.transitionDuration, 600);
        assert.equal(await page.evaluate(() => document.querySelectorAll('#savedConfig, #pageTemplate').length), 2, `round ${round}: one config block and one template, however many saves`);
      }
      // Edit Home, Chat and colors, then save into the link.
      await page.locator('#lightBtn').click();
      await page.locator('#shape').selectOption('wave');
      await page.locator('#backgroundColor').fill('#fafafa');
      await page.locator('#chatBtn').click();
      await page.locator('#shape').selectOption('spiral');
      await page.locator('#darkBtn').click();
      await page.locator('#particleColor').fill('#abcdef');
      await page.locator('#transitionDuration').fill('600');
      await page.locator('#transitionDuration').dispatchEvent('change');
      await page.locator('#copyPreviewBtn').click();
      await page.waitForTimeout(200);
      assert.deepEqual(await page.evaluate(() => window.__copied), [url], 'the link copied is the published page address');
      const published = await page.evaluate(() => window.__published);
      assert.equal(published.length, 1);
      const doc = published[0];
      assert(doc.startsWith('<!doctype html><html><head><meta charset=utf8>'), 'document uses the platform skeleton');
      assert(doc.includes('id="savedConfig">{'), 'config embedded');
      assert(doc.includes('id="pageTemplate">') && !/id="pageTemplate"><\/script>/.test(doc), 'template carried forward');
      html = doc; // what the platform would serve next
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS hosted page saves Home/Chat settings and colors into itself and restores them across repeated saves');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
