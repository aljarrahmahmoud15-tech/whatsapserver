const assert = require('node:assert/strict');
const fs = require('node:fs');

const page = fs.readFileSync('public/admin-v26.html', 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] || '';

assert.match(script, /async function loadBootstrap\(\)[\s\S]*?api\('\/api\/admin\/v27\/bootstrap'\)/);
assert.match(script, /async function login\(\)[\s\S]*?await loadBootstrap\(\)/);
assert.doesNotMatch(script, /async function login\(\)[\s\S]*?await loadData\(\)/);
assert.match(script, /if\(screen!==\'admin\'\)void loadScreenData\(screen\)/);
assert.match(script, /async function loadScreenData\(screen,force=false\)/);
for (const route of [
  '/api/admin/captains?fresh=1',
  '/api/admin/orders',
  '/api/admin/orders/open?summary=1',
  '/api/admin/settlements?limit=300',
  '/api/admin/staff',
]) assert.match(script, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(script, /async function loadAdminActionData\(kind\)/);
assert.match(script, /api\('\/api\/admin\/captain-invites'\)/);
assert.match(script, /api\('\/api\/admin\/cards\?limit=100'\)/);
assert.match(script, /api\('\/api\/admin\/leads'\)/);
assert.match(script, /state\.fullDataLoaded=true;state\.loadedScreens=\{captains:true,negative:true,orders:true,settlements:true,staff:true\}/);
assert.match(script, /state\.bootstrap\?\.summary/);
assert.match(script, /'تُحمّل عند فتح النافذة'/);
assert.match(script, /function resetV26DashboardData\(\)/);
assert.doesNotMatch(script, /ensureFullData\(/);

console.log('V26 quick bootstrap and per-panel lazy loading: PASS');
