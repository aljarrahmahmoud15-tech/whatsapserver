const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('server.js', 'utf8');

assert(source.includes('app.post("/api/admin/group/import-members"'), 'import route is missing');
assert(source.includes('app.get("/api/admin/group/member-import-status"'), 'import status route is missing');
assert(source.includes('requireAdmin, adminMutationLimiter'), 'import route must be admin protected and rate limited');
assert(source.includes('req.body?.execute === true'), 'execution must be opt-in');
assert(source.includes('ADD_GROUP_MEMBERS'), 'explicit execution confirmation is missing');
assert(source.includes('groupId !== WHATSAPP_GROUP_ID'), 'official-group isolation guard is missing');
assert(source.includes('isBlockedPhone(phone)'), 'blocked-phone guard is missing');
assert(source.includes('alreadyPresent'), 'existing-member preview is missing');
assert(source.includes('group.members.import_preview'), 'preview audit is missing');
assert(source.includes('group.members.imported'), 'execution audit is missing');
assert(!source.includes('app.post("/api/admin/group/import-members"') || source.includes('if (!execute)'));

console.log('group member import route guardrails: OK');
