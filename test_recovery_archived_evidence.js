const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('./server.js', 'utf8');
assert.match(source, /const archivedQuoted = typeof acceptance\.getQuotedMessage === "function"/);
assert.match(source, /let liveQuoted = archivedQuoted/);
assert.match(source, /const quoted = liveQuoted \|\| liveAcceptance\.__quoted \|\| archivedQuoted \|\| acceptance\.__quoted \|\| null/);
assert.match(source, /const liveReactions = \(!Array\.isArray\(archivedReactions\)/);
assert.match(source, /const archivedReactions = typeof acceptance\.getReactions === "function"/);
assert.match(source, /liveAcceptance\.__reactions \|\| acceptance\.__reactions \|\| \[\]/);
assert.match(source, /const reactionPresentOnAcceptance = Boolean\(acceptance\.hasReaction \|\| acceptance\.__hasReaction\)/);
assert.match(source, /if \(botProducer && reactionPresentOnAcceptance\) reactedByBot = true/);
assert.match(source, /client\.interface\.openChatWindowAt\(acceptanceMessageId\)/);
assert.match(source, /const hydratedAcceptance = typeof client\.getMessageById === "function"/);
assert.match(source, /mutation: "none"/);
console.log('archived quote and reaction evidence fallback verified');
