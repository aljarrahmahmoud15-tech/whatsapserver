const assert = require('assert');
const fs = require('fs');

function loadHelper(file, functionName) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`function\\s+${functionName}\\(c\\)\\s*\\{([^}]*)\\}`));
  assert.ok(match, `${file} must define ${functionName}(c)`);
  return new Function('c', match[1]);
}

const syncedName = 'اسم واتساب المتزامن';
const registeredName = 'الاسم المسجل المحفوظ';
const staleName = 'اسم التسجيل القديم';
const numericName = '1234567890';

for (const [file, helperName] of [
  ['public/admin-v27.html', 'captainName'],
  ['public/admin-v24.html', 'nameOf'],
  ['public/admin-merged-readonly.html', 'captainName'],
]) {
  const helper = loadHelper(file, helperName);
  assert.strictEqual(
    helper({ displayName: syncedName, name: syncedName, registrationName: staleName, registration_name: staleName }),
    syncedName,
    `${file} must display the synced WhatsApp name before registration_name`
  );
  assert.strictEqual(
    helper({ displayName: 'كابتن بدون اسم', name: numericName, registrationName: registeredName }),
    registeredName,
    `${file} must preserve the registered name as fallback when WhatsApp name is unavailable or numeric`
  );
  assert.strictEqual(
    helper({ displayName: '', name: syncedName, registrationName: staleName }),
    syncedName,
    `${file} must prefer the current name when displayName is absent`
  );
  assert.strictEqual(
    helper({ displayName: 'كابتن بدون اسم', name: numericName, registrationName: numericName }),
    'كابتن بدون اسم',
    `${file} must not render a phone-like value as a name`
  );
}

for (const [file, helperName] of [
  ['public/admin-v26.html', 'captainName'],
  ['admin.html', 'captainUiName'],
]) {
  const helper = loadHelper(file, helperName);
  assert.strictEqual(
    helper({ name: syncedName, displayName: syncedName, registrationName: staleName, registration_name: staleName }),
    syncedName,
    `${file} must continue to display the current name before registration_name`
  );
}

console.log('captain panel synced-name precedence verified');
