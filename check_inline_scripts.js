const fs = require('fs');
const { execFileSync } = require('child_process');
const html = fs.readFileSync('./public/index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
if (!scripts.length) throw new Error('No inline scripts found');
for (const [index, source] of scripts.entries()) {
  const target = `/tmp/aljarah-index-inline-${index}.js`;
  fs.writeFileSync(target, source);
  execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
}
console.log(`checked ${scripts.length} inline script(s)`);
