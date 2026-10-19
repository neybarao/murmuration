const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:4174/');
    await page.locator('#shape').selectOption('wave');
    await page.locator('#responseToggle').click();
    await page.waitForTimeout(400);
    await page.locator('#shape').selectOption('spiral');
    await page.locator('#themeToggle').click();
    await page.locator('#particleColor').fill('#abcdef');
    await page.locator('#backgroundColor').fill('#123456');
    await page.locator('#overlayToggle').click();
    await page.locator('#transitionDuration').fill('750');
    await page.locator('#transitionDuration').dispatchEvent('change');
    const expected = await page.evaluate(() => sharedPreviewState());
    await page.locator('#copyBtn').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, await page.locator('#exportCode').inputValue());
    assert(copied.includes('transitionDuration: 750'));
    assert(!copied.includes('"theme"') && !copied.includes('"overlay"'));
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'murmuration-background.js');
    const source = fs.readFileSync(await download.path(), 'utf8');
    const exported = await page.evaluate(async source => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const mod = await import(url);
      URL.revokeObjectURL(url);
      const host = document.createElement('div'); document.body.appendChild(host);
      const instance = mod.createMurmurationBackground(host);
      const backend = instance.canvas.dataset.renderer;
      instance.transitionTo('chat', 0);
      instance.setState('extra', { ...mod.murmurationStates.home, shape: 'circle' });
      instance.transitionTo('extra', 0);
      instance.destroy(); host.remove();
      return { states: mod.murmurationStates, duration: mod.defaultTransitionDuration, backend };
    }, source);
    assert.equal(exported.backend, 'webgl2');
    assert.equal(exported.duration, 750);
    assert.deepEqual(exported.states.home, expected.states.information);
    assert.deepEqual(exported.states.chat, expected.states.response);
    await page.locator('#copyPreviewBtn').click();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    const recipient = await browser.newPage();
    await recipient.goto(url);
    assert.deepEqual(await recipient.evaluate(() => sharedPreviewState()), expected);
    // Force actual WebGL unavailability, rather than explicitly selecting Canvas.
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
    await fallback.goto(url);
    assert.equal(await fallback.evaluate(() => canvas.dataset.renderer), 'canvas2d');
    assert.deepEqual(await fallback.evaluate(() => sharedPreviewState()), expected);
    assert.deepEqual(errors, []);
    console.log('PASS actual Copy, Download JS/import, duration, named states, colors, fresh preview and automatic Canvas fallback');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
