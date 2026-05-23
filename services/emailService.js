import nodemailer from "nodemailer";
import handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";
import { addEmailJob } from "../utils/emailQueue.js";
import env from "../utils/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize transporter with fallback for development
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === "true",
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    })
  : nodemailer.createTransport({
      host: "localhost",
      port: 1025,
      secure: false,
    });

// Verify connection on startup (non-blocking)
if (env.SMTP_HOST) {
  transporter.verify((error) => {
    if (error) {
      logger.error("EMAIL SERVICE FAILED — transactional emails will not send", {
        error: error.message,
        hint: "Check SMTP_HOST, SMTP_USER, SMTP_PASS in .env",
      });
      console.error("EMAIL NOT WORKING:", error.message);
    } else {
      logger.info("Email service ready");
      console.log("Email service connected");
    }
  });
}

// Load and compile templates
const templatesDir = path.join(__dirname, "../templates/emails");

function loadTemplate(templateName) {
  try {
    const templatePath = path.join(templatesDir, `${templateName}.hbs`);
    if (!fs.existsSync(templatePath)) {
      logger.warn("Email template not found", { template: templateName });
      return null;
    }
    const templateContent = fs.readFileSync(templatePath, "utf-8");
    return handlebars.compile(templateContent);
  } catch (error) {
    logger.error("Failed to load template", {
      template: templateName,
      error: error.message,
    });
    return null;
  }
}

async function sendPlainEmail(to, subject, html) {
  if (!to || !env.SMTP_HOST) return { success: false, error: "SMTP not configured" };
  try {
    await transporter.sendMail({
      from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (error) {
    logger.warn("Email send failed", { to, subject, error: error.message });
    return { success: false, error: error.message };
  }
}

export const emailService = {
  async sendCustomerSignup(customer) {
    try {
      const template = loadTemplate("customer-signup");
      if (!template) return { success: false, error: "Template not found" };

      const html = template({
        fullName: customer.fullName,
        email: customer.email,
        appUrl: env.FRONTEND_URL || "http://localhost:5173",
      });

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: customer.email,
        subject: "Welcome to Fix It Now!",
        html,
      });

      logger.info("Customer signup email sent", { email: customer.email });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send customer signup email", {
        email: customer.email,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendWorkerApproval(worker) {
    try {
      const template = loadTemplate("worker-approved");
      if (!template) return { success: false, error: "Template not found" };

      const html = template({
        fullName: worker.fullName,
        email: worker.emailAddress,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      });

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: worker.emailAddress,
        subject: "Your Worker Application Has Been Approved! 🎉",
        html,
      });

      logger.info("Worker approval email sent", { email: worker.emailAddress });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send worker approval email", {
        email: worker.emailAddress,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendWorkerApprovalPending(worker) {
    try {
      const template = loadTemplate("worker-pending");
      if (!template) return { success: false, error: "Template not found" };

      const html = template({
        fullName: worker.fullName,
        email: worker.emailAddress,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      });

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: worker.emailAddress,
        subject: "Thank You for Your Application!",
        html,
      });

      logger.info("Worker pending email sent", { email: worker.emailAddress });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send worker pending email", {
        email: worker.emailAddress,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendVerificationCode(user, code, role = "customer") {
    try {
      const email = role === "worker" ? user.emailAddress : user.email;
      const fullName = role === "worker" ? user.fullName : user.fullName;
      const subject = "Verify your Fix It Now email address";
      const html = `
        <p>Hi ${fullName || "there"},</p>
        <p>Use the code below to verify your email address for Fix It Now:</p>
        <p style="font-size: 1.25rem; font-weight: bold; margin: 1rem 0;">${code}</p>
        <p>This code expires in 15 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      `;

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: email,
        subject,
        html,
      });

      logger.info("Verification code email sent", { email, role });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send verification code email", {
        email: role === "worker" ? user.emailAddress : user.email,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendPasswordResetCode(user, code, role = "customer") {
    try {
      const email = role === "worker" ? user.emailAddress : user.email;
      const fullName = role === "worker" ? user.fullName : user.fullName;
      const subject = "Reset your Fix It Now password";
      const html = `
        <p>Hi ${fullName || "there"},</p>
        <p>Use the code below to reset your Fix It Now password:</p>
        <p style="font-size: 1.25rem; font-weight: bold; margin: 1rem 0;">${code}</p>
        <p>This code expires in 15 minutes.</p>
        <p>If you did not request a password reset, please ignore this email.</p>
      `;

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: email,
        subject,
        html,
      });

      logger.info("Password reset code email sent", { email, role });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send password reset code email", {
        email: role === "worker" ? user.emailAddress : user.email,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendWorkerRejection(
    worker,
    reason = "Your application did not meet our requirements",
  ) {
    try {
      const template = loadTemplate("worker-rejected");
      if (!template) return { success: false, error: "Template not found" };

      const html = template({
        fullName: worker.fullName,
        email: worker.emailAddress,
        reason,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      });

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: worker.emailAddress,
        subject: "Update on Your Worker Application",
        html,
      });

      logger.info("Worker rejection email sent", {
        email: worker.emailAddress,
      });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send worker rejection email", {
        email: worker.emailAddress,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendBookingStatusUpdate(customer, booking, status) {
    try {
      const template = loadTemplate("booking-status-update");
      if (!template) return { success: false, error: "Template not found" };

      const html = template({
        fullName: customer.fullName,
        bookingId: booking._id,
        serviceTitle: booking.serviceTitle,
        status: status.charAt(0).toUpperCase() + status.slice(1),
        appUrl: env.FRONTEND_URL || "http://localhost:5173",
      });

      await transporter.sendMail({
        from: `${env.SMTP_FROM_NAME} <${env.SMTP_FROM_EMAIL}>`,
        to: customer.email,
        subject: `Booking Update: ${booking.serviceTitle}`,
        html,
      });

      logger.info("Booking status email sent", {
        email: customer.email,
        bookingId: booking._id,
        status,
      });
      return { success: true };
    } catch (error) {
      logger.warn("Failed to send booking status email", {
        email: customer.email,
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  },

  async sendBookingReceived(customer, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>We received your booking for <strong>${booking.serviceTitle}</strong>.</p>
      <p>Status: <strong>Pending review</strong>. We will notify you when it is approved.</p>
      <p><a href="${env.FRONTEND_URL}">View your bookings</a></p>`;
    return sendPlainEmail(customer.email, `Booking received: ${booking.serviceTitle}`, html);
  },

  async sendBookingApproved(customer, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>Your booking <strong>${booking.serviceTitle}</strong> has been <strong>approved</strong>.</p>
      <p>We will assign a worker shortly.</p>`;
    return sendPlainEmail(customer.email, `Booking approved: ${booking.serviceTitle}`, html);
  },

  async sendWorkerAssigned(customer, worker, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>A worker has been assigned to your booking <strong>${booking.serviceTitle}</strong>.</p>
      <p><strong>${worker.fullName}</strong> — ${worker.phoneNumber || ""}</p>`;
    const workerHtml = `<p>Hi ${worker.fullName},</p>
      <p>You have been assigned a new job: <strong>${booking.serviceTitle}</strong>.</p>
      <p>Customer: ${booking.customerName} — ${booking.phone || ""}</p>
      <p>Address: ${booking.address || booking.location || "See app"}</p>`;
    await sendPlainEmail(customer.email, `Worker assigned: ${booking.serviceTitle}`, html);
    if (worker.emailAddress) {
      await sendPlainEmail(worker.emailAddress, `New job: ${booking.serviceTitle}`, workerHtml);
    }
    return { success: true };
  },

  async sendWorkerAccountStatus(worker, status, reason = "") {
    const messages = {
      approved: "Your worker account has been approved. You can log in and accept jobs.",
      rejected: `Your application was rejected. ${reason}`,
      inactive: "Your account has been set to inactive. Contact support if this is unexpected.",
      active: "Your worker account is active again.",
      deleted: "Your worker account has been deleted from Fix It Now.",
    };
    const html = `<p>Hi ${worker.fullName},</p><p>${messages[status] || `Account status: ${status}`}</p>`;
    return sendPlainEmail(
      worker.emailAddress,
      `Fix It Now — account ${status}`,
      html,
    );
  },

  async sendAdminAccountStatus(admin, status) {
    const html = `<p>Hi ${admin.name || admin.fullName},</p>
      <p>Your admin account is now <strong>${status}</strong>.</p>`;
    return sendPlainEmail(admin.email, `Admin account ${status}`, html);
  },
};

export default emailService;

// Export queue-enabled versions
export const sendCustomerSignupEmailQueued = async (to, name) => {
  await addEmailJob({
    type: "customer_signup",
    to,
    name,
  });
};

export const sendWorkerPendingEmailQueued = async (to, name) => {
  await addEmailJob({
    type: "worker_pending",
    to,
    name,
  });
};

export const sendWorkerApprovedEmailQueued = async (to, name) => {
  await addEmailJob({
    type: "worker_approved",
    to,
    name,
  });
};

export const sendWorkerRejectedEmailQueued = async (to, name, reason) => {
  await addEmailJob({
    type: "worker_rejected",
    to,
    name,
    reason,
  });
};

export const sendBookingCreatedEmailQueued = async (to, name, bookingId) => {
  await addEmailJob({
    type: "booking_created",
    to,
    name,
    bookingId,
  });
};

export const sendBookingStatusEmailQueued = async (
  to,
  name,
  status,
  bookingId,
) => {
  await addEmailJob({
    type: "booking_status",
    to,
    name,
    status,
    bookingId,
  });
};
