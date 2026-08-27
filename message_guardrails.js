function isBotGeneratedMessage(message) {
  return Boolean(message && message.fromMe);
}

function normalizePhone(value = "") {
  const digits = String(value).replace(/[^0-9]/g, "").replace(/^00/, "");
  return digits.replace(/^9627/, "07");
}

function isBotReactionSender(senderPhone, botPhone) {
  const sender = normalizePhone(senderPhone);
  const bot = normalizePhone(botPhone);
  return Boolean(sender && bot && sender === bot);
}

function isBotFinancialRole(phone, botPhone, role) {
  return isBotReactionSender(phone, botPhone) && role !== "company";
}

module.exports = {
  isBotGeneratedMessage,
  isBotReactionSender,
  isBotFinancialRole,
};
