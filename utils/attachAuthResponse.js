import { setAuthCookies, USE_HTTPONLY_AUTH } from "./authCookies.js";

/**
 * Attach auth credentials to the response.
 * In HttpOnly-cookie mode, tokens are delivered only through cookies and are
 * never exposed in the JSON response body.
 */
export function attachAuthToResponse(res, { accessToken, refreshToken, body }) {
  setAuthCookies(res, { accessToken, refreshToken });

  if (USE_HTTPONLY_AUTH) {
    return { ...body };
  }

  return {
    ...body,
    token: accessToken,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}
