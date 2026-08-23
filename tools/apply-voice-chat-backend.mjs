import fs from "node:fs";

const path = "index.js";
let source = fs.readFileSync(path, "utf8");
const importAnchor = 'import { getAccessTokenFromRequest } from "./utils/authCookies.js";';
const importReplacement = `${importAnchor}\nimport { registerVoiceCallSocketHandlers } from "./utils/voiceCallSocket.js";`;
if (!source.includes("registerVoiceCallSocketHandlers")) {
  if (!source.includes(importAnchor)) throw new Error("index.js auth import anchor not found");
  source = source.replace(importAnchor, importReplacement);
}
const handlerAnchor = '  socket.on("disconnect", () => {';
if (!source.includes("registerVoiceCallSocketHandlers(socket)")) {
  if (!source.includes(handlerAnchor)) throw new Error("index.js socket disconnect anchor not found");
  source = source.replace(handlerAnchor, '  registerVoiceCallSocketHandlers(socket);\n\n' + handlerAnchor);
}
fs.writeFileSync(path, source, "utf8");
console.log("Backend voice signaling registration applied.");
