const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const dockerfile = fs.readFileSync('./Dockerfile', 'utf8');
const patchScriptPath = path.join('scripts', 'patch-whatsapp-web-media.js');
const patchScript = fs.readFileSync(patchScriptPath, 'utf8');
const server = fs.readFileSync('./server.js', 'utf8');
const injectedUtilsPath = path.join('node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
const injectedUtils = fs.readFileSync(injectedUtilsPath, 'utf8');

assert.equal(packageJson.scripts.postinstall, 'node scripts/patch-whatsapp-web-media.js', 'npm install يشغل patch الوسائط تلقائيًا');
assert.match(patchScript, /delete message\.\__x_id;/, 'الـ patch يحذف المعرف الداخلي المتعارض');
assert.match(patchScript, /Unsupported whatsapp-web\.js Utils\.js layout/, 'الـ patch يفشل بأمان عند تغير layout');
assert.match(injectedUtils, /delete message\.__x_id;/, 'النسخة المثبتة تحتوي إصلاح تعارض معرف الوسائط');
assert.equal((injectedUtils.match(/delete message\.\__x_id;/g) || []).length, 1, 'إصلاح __x_id مطبق مرة واحدة فقط');
assert.ok(server.indexOf('applyWhatsAppMediaPatch()') < server.indexOf('require("whatsapp-web.js")'), 'patch startup يسبق تحميل مكتبة WhatsApp');
assert.match(server, /mediaPatch: \{/, 'واجهة حالة المالك تعرض حالة patch الوسائط');
assert.match(server, /remove-private-media-id-collision/, 'واجهة الحالة تعرض استراتيجية patch الصحيحة');
assert.ok(dockerfile.indexOf('COPY scripts ./scripts') < dockerfile.indexOf('RUN npm ci --omit=dev'), 'Dockerfile ينسخ script قبل postinstall');

console.log('whatsapp-web.js media id collision patch verified');
