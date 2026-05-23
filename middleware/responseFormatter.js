/**
 * Middleware for standardized API responses
 * All API endpoints should return consistent response format:
 * {
 *   success: boolean,
 *   message: string,
 *   data?: any,
 *   pagination?: object,
 *   errors?: array
 * }
 */

export const responseFormatterMiddleware = (req, res, next) => {
  // Store original res.json
  const originalJson = res.json.bind(res);

  // Override res.json to ensure consistent formatting
  res.json = function (body) {
    // If already formatted, send as-is
    if (
      body &&
      typeof body === "object" &&
      "success" in body &&
      "message" in body
    ) {
      return originalJson(body);
    }

    // If it's an error response with error field, format it
    if (body && body.error) {
      return originalJson({
        success: false,
        message: body.error,
        statusCode: res.statusCode,
      });
    }

    // Otherwise wrap in standard format
    return originalJson({
      success: res.statusCode >= 200 && res.statusCode < 300,
      message: body?.message || "Success",
      data: body?.data || body,
      ...(body?.pagination && { pagination: body.pagination }),
    });
  };

  next();
};

export default responseFormatterMiddleware;
