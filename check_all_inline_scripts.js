const fs = require('fs');
const { execFileSync } = require('child_process');
const pages = ['public/index.html', 'public/join.html', 'public/captain.html', 'public/support.html'];
let count = 0;
for (const page of pages) {
  const html = fs.readFileSync(page, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  for (const [index, source] of scripts.entries()) {
    const target = `/tmp/aljarah-${page.replace(/[^a-z0-9]/gi, '-')}-${index}.js`;
    fs.writeFileSync(target, source);
    execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
    count += 1;
  }
}
if (!count) throw new Error('No inline scripts found');
console.log(`checked ${count} inline scripts across ${pages.length} pages`);
