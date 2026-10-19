// Builds the single-file hosted page: scripts inlined, plus a copy of the page's own template so
// the page can save the editor's settings into itself (see "Hosted pages" in index.html).
// Usage: node tools/build-artifact.cjs <published-url> [out-file]
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const [url, out = path.join(root, 'dist', 'index.html')] = process.argv.slice(2);
if (!url) { console.error('usage: node tools/build-artifact.cjs <published-url> [out-file]'); process.exit(1); }

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="\.\/([\w.-]+\.js)"><\/script>/g, (match, file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (/<\/script/i.test(source)) throw new Error(`${file} contains a closing script tag`);
  return `<script>\n${source}\n</script>`;
});
html = html.replace('<head>', `<head>\n  <meta name="published-url" content="${url}">`);
const template = html;
if (/<@(\/script|!--)/.test(template)) throw new Error('template contains the escape token');
const holder = '<script type="text/plain" id="pageTemplate">' + template.replace(/<\/script/g, '<@/script').replace(/<!--/g, '<@!--') + '</' + 'script>';
const empty = '<script type="text/plain" id="pageTemplate"></' + 'script>';
if (!template.includes(empty)) throw new Error('template holder missing');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, template.replace(empty, () => holder));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
