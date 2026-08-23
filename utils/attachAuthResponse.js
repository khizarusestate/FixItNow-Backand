import { setAuthCookies } from "./authCookies.js";

/**
 * Attach auth credentials to the response.
 *
 * The API sets HttpOnly cookies as an additional browser-session mechanism,
 * but it MUST also return the access/refresh token pair. The deployed
 * customer/worker/admin SPAs can be cross-origin from the API and therefore
 * use Authorization: Bearer tokens. Keeping both mechanisms here makes the
 * server contract deterministic instead of silently changing the response
 * shape based on an environment flag.
 */
export function attachAuthToResponse(res, { accessToken, refreshToken, body }) {
  setAuthCookies(res, { accessToken, refreshToken });

  return {
    ...body,
    token: accessToken,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}
