const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined, channel: process.env.CHROME_BIN ? undefined : 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4174/?renderer=webgl2');
      await page.waitForTimeout(1000);
      assert.equal(await page.evaluate(() => canvas.dataset.renderer), 'webgl2');
      const pixels = () => page.evaluate(() => {
        const gl = canvas.getContext('webgl2');
        const data = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        let dark = 0, hash = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] < 250) dark++;
          hash = (hash * 31 + data[i]) | 0;
        }
        return { dark, hash, error: gl.getError() };
      });
      const first = await pixels();
      await page.waitForTimeout(250);
      const second = await pixels();
      assert(first.dark > 100, 'particle canvas is nonblank');
      assert.notEqual(first.hash, second.hash, 'particles are moving');
      assert.equal(second.error, 0);
      for (const shape of ['ridge', 'wave', 'arch', 'vortex', 'veil', 'spiral', 'circle', 'flock', 'swoop', 'split-flock']) {
        await page.locator('#shape').selectOption(shape);
        await page.waitForTimeout(50);
        assert.equal((await pixels()).error, 0);
      }
      await page.locator('#darkBtn').click();
      await page.waitForTimeout(100);
      assert.equal((await pixels()).error, 0);
      await page.locator('#lightBtn').click();
      await page.locator('#chatBtn').click();
      await page.waitForTimeout(400);
      await page.locator('#shape').selectOption('circle');
      await page.screenshot({ path: `/tmp/murmuration-webgl-${viewport.width}.png` });
      const moduleResult = await page.evaluate(async () => {
        const url = URL.createObjectURL(new Blob([exportedModule()], { type: 'text/javascript' }));
        const mod = await import(url);
        URL.revokeObjectURL(url);
        const host = document.createElement('div');
        document.body.appendChild(host);
        const instance = mod.createMurmurationBackground(host);
        instance.transitionTo('chat', 200);
        await new Promise(resolve => setTimeout(resolve, 300));
        const backend = instance.canvas.dataset.renderer;
        instance.destroy();
        host.remove();
        return backend;
      });
      assert.equal(moduleResult, 'webgl2');
      await page.evaluate(() => {
        const gl = canvas.getContext('webgl2');
        const extension = gl.getExtension('WEBGL_lose_context');
        if (!extension) throw Error('Context-loss test extension unavailable');
        window.restoreTestContext = () => extension.restoreContext();
        extension.loseContext();
      });
      await page.waitForTimeout(100);
      await page.evaluate(() => window.restoreTestContext());
      await page.waitForTimeout(400);
      assert.equal((await pixels()).error, 0);
      assert((await pixels()).dark > 100);
      assert.deepEqual(errors, []);
      await page.goto('http://127.0.0.1:4174/?renderer=canvas2d');
      assert.equal(await page.evaluate(() => canvas.dataset.renderer), 'canvas2d');
      await page.close();
      console.log('PASS WebGL2 rendering, motion, transitions, export and Canvas fallback:', viewport);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
