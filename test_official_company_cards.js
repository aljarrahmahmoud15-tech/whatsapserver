const assert = require('assert');
const fs = require('fs');

const server = fs.readFileSync('./server.js', 'utf8');
const index = fs.readFileSync('./public/index.html', 'utf8');

assert(server.includes('async function sendCompanyOperationsCard'), 'company card sender exists');
assert(server.includes('renderOperationsMessageMedia(title, lines)'), 'individual company replies render branded media');
assert(server.includes('async function sendBotText(to, text)'), 'text API is preserved as a compatibility wrapper');
assert(server.includes('return sendCompanyOperationsCard(to, "رسالة رسمية من شركة الجراح", lines)'), 'ordinary company messages use the official card');
assert(server.includes('sendCaptainOperationsCard(`${phoneWithCountry(invite.phone)}@c.us`, "تم اعتماد تسجيل الكابتن"'), 'captain approval is sent as a branded card');
assert(server.includes('const media = await renderTopupCardMedia({ cardId: card.lastInsertRowid'), 'top-up request fulfillment renders a card image');
assert(server.includes('client.sendMessage(`${phone}@c.us`, media, { caption })'), 'top-up request sends the generated card in the same action');
assert(index.includes('.hero-card{padding:17px 20px'), 'owner request console is compact');
assert(index.includes('id="topup-requests-open"'), 'top-up requests remain accessible from the compact console');
assert(index.includes('data-topup-fulfill'), 'top-up approval remains a single fulfill-and-send action');
console.log('official company card and compact top-up flow guardrails verified');
