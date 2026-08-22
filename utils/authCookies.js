import env from "./env.js";

export const ACCESS_COOKIE = "fixitnow_access";
export const REFRESH_COOKIE = "fixitnow_refresh";

export const USE_HTTPONLY_AUTH = env.USE_HTTPONLY_AUTH !== false;

export function parseCookieHeader(header = "") {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return [part.trim(), ""];
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      try {
        return [key, decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    }),
  );
}

export function getAccessTokenFromRequest(req) {
  // HttpOnly cookie is the authoritative session when cookie auth is enabled.
  // This prevents a stale/invalid legacy Bearer token from overriding a valid
  // freshly-issued cookie session. Keep Bearer as a fallback for legacy clients.
  const cookies = parseCookieHeader(req.headers?.cookie);
  if (USE_HTTPONLY_AUTH && cookies[ACCESS_COOKIE]) {
    return cookies[ACCESS_COOKIE];
  }

  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }

  return cookies[ACCESS_COOKIE] || "";
}

export function getRefreshTokenFromRequest(req) {
  const bodyToken = req.body?.refreshToken;
  if (bodyToken) return bodyToken;
  const cookies = parseCookieHeader(req.headers?.cookie);
  return cookies[REFRESH_COOKIE] || "";
}

function cookieBaseOptions() {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  };
}

export function setAuthCookies(res, { accessToken, refreshToken }) {
  if (!USE_HTTPONLY_AUTH || !accessToken) return;
  const base = cookieBaseOptions();
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base,
    maxAge: env.ACCESS_TOKEN_EXPIRY_MINUTES * 60 * 1000,
  });
  if (refreshToken) {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      maxAge: env.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    });
  }
}

export function clearAuthCookies(res) {
  const base = cookieBaseOptions();
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}
