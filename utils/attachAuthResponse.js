import { setAuthCookies } from "./authCookies.js";

/** Attach tokens to JSON body (legacy) and httpOnly cookies when enabled. */
export function attachAuthToResponse(res, { accessToken, refreshToken, body }) {
  setAuthCookies(res, { accessToken, refreshToken });
  return {
    ...body,
    token: accessToken,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}
