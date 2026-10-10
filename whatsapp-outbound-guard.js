"use strict";

const OUTBOUND_GUARD_MARKER = Symbol.for("whatsapserver.cleanOutboundGuard");

/**
 * Wrap a WhatsApp client transport method with a synchronous policy check.
 * The original method is invoked only when shouldBlock returns a falsy value.
 * This module has no WhatsApp, network, or filesystem side effects so the
 * boundary can be tested using a small fake client.
 */
function guardOutboundMethod(instance, methodName, shouldBlock) {
  if (!instance || typeof instance[methodName] !== "function") return false;
  const original = instance[methodName];
  if (original[OUTBOUND_GUARD_MARKER]) return true;

  const guarded = async function (...args) {
    const blocked = typeof shouldBlock === "function" ? shouldBlock(methodName, args) : null;
    if (blocked) {
      const error = blocked instanceof Error ? blocked : new Error("WhatsApp outbound operation is blocked");
      throw error;
    }
    return original.apply(this, args);
  };

  Object.defineProperty(guarded, OUTBOUND_GUARD_MARKER, { value: true });
  Object.defineProperty(guarded, "__waslniOutboundGuard", { value: methodName });
  instance[methodName] = guarded;
  return true;
}

module.exports = { guardOutboundMethod };
