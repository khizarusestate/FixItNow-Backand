import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function getKey() {
  const configured = String(process.env.MESSAGE_ENCRYPTION_KEY || "").trim();
  const source = configured || String(process.env.JWT_SECRET || "").trim();
  if (!source) throw new Error("MESSAGE_ENCRYPTION_KEY or JWT_SECRET must be configured for message encryption.");
  return crypto.createHash("sha256").update(source).digest();
}

export function encryptMessage(plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptMessage(payload) {
  try {
    const [ivText, tagText, cipherText] = String(payload || "").split(".");
    if (!ivText || !tagText || !cipherText) return "[Unable to decrypt message]";
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "[Unable to decrypt message]";
  }
}
