const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'manus-routes.json'), 'utf8'));

test('V27 pilot route exposes the direct-ride screen without changing the approved customer page', () => {
  assert.match(server, /app\.get\("\/v27\/pilot\/ride", v27PageLimiter/);
  assert.match(server, /app\.get\("\/v27\/pilot\/ride"[\s\S]*?sendFile\(path\.join\(__dirname, "public", "ride\.html"\)\)/);
  assert.match(server, /app\.get\("\/ride\.html", v27PageLimiter[\s\S]*?res\.redirect\(302, "\/book\.html"\)/);
  assert.ok(manifest.routes.some((route) => route.path === '/v27/pilot/ride' && route.title === 'اختبار رحلة V27'));
});
