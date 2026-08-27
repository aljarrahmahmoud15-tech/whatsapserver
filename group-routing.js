function resolveGroupChatId(message) {
  const candidates = [message && message.from, message && message.to, message && message.id && message.id.remote];
  return candidates.map((value) => String(value || "")).find((value) => value.endsWith("@g.us")) || "";
}

module.exports = { resolveGroupChatId };
