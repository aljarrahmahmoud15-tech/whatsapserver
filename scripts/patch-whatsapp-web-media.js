const fs = require("node:fs");
const path = require("node:path");

function applyWhatsAppMediaPatch() {
  const target = path.join(__dirname, "..", "node_modules", "whatsapp-web.js", "src", "util", "Injected", "Utils.js");
  const marker = "delete message.__x_id;";
  const needle = `            ...extraOptions,\n        };\n\n        // Bot's won't reply if canonicalUrl is set (linking)\n`;
  const replacement = `            ...extraOptions,\n        };\n\n        // whatsapp-web.js 1.34.7 mediaOptions exposes a private id that collides with Msg.id.\n        delete message.__x_id;\n\n        // Bot's won't reply if canonicalUrl is set (linking)\n`;

  if (!fs.existsSync(target)) {
    throw new Error(`whatsapp-web.js injected Utils.js was not found at ${target}`);
  }

  const source = fs.readFileSync(target, "utf8");
  if (source.includes(marker)) return { target, applied: false, alreadyPatched: true };
  if (!source.includes(needle)) {
    throw new Error("Unsupported whatsapp-web.js Utils.js layout; media id collision patch was not applied");
  }
  const patched = source.replace(needle, replacement);
  if (patched === source) {
    throw new Error("whatsapp-web.js media id collision patch produced no change");
  }
  fs.writeFileSync(target, patched);
  return { target, applied: true, alreadyPatched: false };
}

if (require.main === module) {
  const result = applyWhatsAppMediaPatch();
  console.log(result.alreadyPatched ? "whatsapp-web.js media id collision patch already applied" : "patched whatsapp-web.js media id collision in Injected/Utils.js");
}

module.exports = applyWhatsAppMediaPatch;
