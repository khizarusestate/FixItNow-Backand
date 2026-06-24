import { OAuth2Client } from "google-auth-library";
import env from "../utils/env.js";

let client = null;

function getClient() {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  if (!clientId) return null;
  if (!client) client = new OAuth2Client(clientId);
  return client;
}

/** Verify Google ID token from GIS / OAuth button. Returns payload or throws. */
export async function verifyGoogleIdToken(idToken) {
  const oauth = getClient();
  if (!oauth) {
    const err = new Error("Google sign-in is not configured on the server.");
    err.code = "GOOGLE_NOT_CONFIGURED";
    throw err;
  }
  const ticket = await oauth.verifyIdToken({
    idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload?.sub) {
    throw new Error("Google account email could not be verified.");
  }
  return payload;
}

export function isGoogleAuthEnabled() {
  return Boolean(String(env.GOOGLE_CLIENT_ID || "").trim());
}
