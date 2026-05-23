/**
 * Pagination utility for paginating MongoDB queries
 */

export const paginate = async (query, page = 1, limit = 20) => {
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  try {
    const [data, total] = await Promise.all([
      query.skip(skip).limit(limitNum),
      query.model.countDocuments(query.getFilter()),
    ]);

    const pages = Math.ceil(total / limitNum);

    return {
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages,
        hasNextPage: pageNum < pages,
        hasPrevPage: pageNum > 1,
      },
    };
  } catch (error) {
    throw new Error(`Pagination error: ${error.message}`);
  }
};

/**
 * Response formatter for consistent API responses
 */
export const formatResponse = (
  success,
  message,
  data = null,
  pagination = null,
  errors = null,
) => {
  const response = {
    success,
    message,
    ...(data !== null && { data }),
    ...(pagination && { pagination }),
    ...(errors && { errors }),
  };
  return response;
};

/**
 * Error response formatter
 */
export const formatErrorResponse = (
  message,
  errors = null,
  statusCode = 400,
) => {
  return {
    success: false,
    message,
    ...(errors && { errors }),
    statusCode,
  };
};
