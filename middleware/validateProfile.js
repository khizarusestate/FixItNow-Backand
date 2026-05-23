import Customer from "../customerSchema.js";
import logger from "../utils/logger.js";

/**
 * Middleware to validate customer has completed required profile fields
 * Required: fullName, email, phone, location
 */
export const validateCustomerProfileComplete = async (req, res, next) => {
  try {
    const customerId = req.user?.id || req.user?._id;
    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Customer not found",
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Check required fields
    const requiredFields = ["fullName", "email", "phone", "location"];
    const missingFields = requiredFields.filter((field) => !customer[field]);

    if (missingFields.length > 0) {
      return res.status(403).json({
        success: false,
        message: "Please complete your profile before booking",
        missingFields,
        data: {
          profileComplete: false,
          completionPercentage:
            ((requiredFields.length - missingFields.length) /
              requiredFields.length) *
            100,
        },
      });
    }

    // Attach customer to request for later use
    req.customer = customer;
    next();
  } catch (error) {
    logger.error("Profile validation middleware error", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      message: "Error validating profile",
    });
  }
};

export default validateCustomerProfileComplete;
