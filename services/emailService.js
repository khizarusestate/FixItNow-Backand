import handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";
import { addEmailJob } from "../utils/emailQueue.js";
import env from "../utils/env.js";
import { sendEmail, logEmailServiceStatus } from "./emailApi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

logEmailServiceStatus();

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
  return sendEmail({ to, subject, html });
}

async function sendTemplatedEmail(to, subject, templateName, data) {
  const template = loadTemplate(templateName);
  if (!template) return { success: false, error: "Template not found" };
  const html = template(data);
  const result = await sendEmail({ to, subject, html });
  if (result.success && !result.skipped) {
    logger.info("Templated email sent", { to, subject, template: templateName });
  }
  return result;
}

export const emailService = {
  async sendCustomerSignup(customer) {
    return sendTemplatedEmail(
      customer.email,
      "Welcome to Fix It Now!",
      "customer-signup",
      {
        fullName: customer.fullName,
        email: customer.email,
        appUrl: env.FRONTEND_URL || "http://localhost:5173",
      },
    );
  },

  async sendWorkerApproval(worker) {
    return sendTemplatedEmail(
      worker.emailAddress,
      "Your Worker Application Has Been Approved! 🎉",
      "worker-approved",
      {
        fullName: worker.fullName,
        email: worker.emailAddress,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      },
    );
  },

  async sendWorkerApprovalPending(worker) {
    return sendTemplatedEmail(
      worker.emailAddress,
      "Thank You for Your Application!",
      "worker-pending",
      {
        fullName: worker.fullName,
        email: worker.emailAddress,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      },
    );
  },

  async sendEmailVerificationCode(user, code) {
    const email = user.email;
    const fullName = user.fullName;
    const html = `
      <p>Hi ${fullName || "there"},</p>
      <p>Welcome to Fix It Now! Use the code below to verify your email:</p>
      <p style="font-size: 1.25rem; font-weight: bold; margin: 1rem 0;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not create an account, please ignore this email.</p>
    `;
    return sendEmail({
      to: email,
      subject: "Verify your Fix It Now email",
      html,
    });
  },

  async sendPasswordResetCode(user, code, role = "customer") {
    const email = role === "worker" ? user.emailAddress : user.email;
    const fullName = user.fullName;
    const html = `
      <p>Hi ${fullName || "there"},</p>
      <p>Use the code below to reset your Fix It Now password:</p>
      <p style="font-size: 1.25rem; font-weight: bold; margin: 1rem 0;">${code}</p>
      <p>This code expires in 15 minutes.</p>
      <p>If you did not request a password reset, please ignore this email.</p>
    `;
    return sendEmail({
      to: email,
      subject: "Reset your Fix It Now password",
      html,
    });
  },

  async sendWorkerRejection(
    worker,
    reason = "Your application did not meet our requirements",
  ) {
    return sendTemplatedEmail(
      worker.emailAddress,
      "Update on Your Worker Application",
      "worker-rejected",
      {
        fullName: worker.fullName,
        email: worker.emailAddress,
        reason,
        appUrl: env.FRONTEND_URL || "http://localhost:3000",
      },
    );
  },

  async sendBookingStatusUpdate(customer, booking, status) {
    return sendTemplatedEmail(
      customer.email,
      `Booking Update: ${booking.serviceTitle}`,
      "booking-status-update",
      {
        fullName: customer.fullName,
        bookingId: booking._id,
        serviceTitle: booking.serviceTitle,
        status: status.charAt(0).toUpperCase() + status.slice(1),
        appUrl: env.FRONTEND_URL || "http://localhost:5173",
      },
    );
  },

  async sendBookingReceived(customer, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>We received your booking for <strong>${booking.serviceTitle}</strong>.</p>
      <p>Status: <strong>Pending review</strong>. We will notify you when it is approved.</p>
      <p><a href="${env.FRONTEND_URL}">View your bookings</a></p>`;
    return sendPlainEmail(
      customer.email,
      `Booking received: ${booking.serviceTitle}`,
      html,
    );
  },

  async sendBookingApproved(customer, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>Your booking <strong>${booking.serviceTitle}</strong> has been <strong>approved</strong>.</p>
      <p>We will assign a worker shortly.</p>`;
    return sendPlainEmail(
      customer.email,
      `Booking approved: ${booking.serviceTitle}`,
      html,
    );
  },

  async sendWorkerAssigned(customer, worker, booking) {
    const html = `<p>Hi ${customer.fullName || "there"},</p>
      <p>A worker has been assigned to your booking <strong>${booking.serviceTitle}</strong>.</p>
      <p><strong>${worker.fullName}</strong> — ${worker.phoneNumber || ""}</p>`;
    const workerHtml = `<p>Hi ${worker.fullName},</p>
      <p>You have been assigned a new job: <strong>${booking.serviceTitle}</strong>.</p>
      <p>Customer: ${booking.customerName} — ${booking.phone || ""}</p>
      <p>Address: ${booking.address || booking.location || "See app"}</p>`;
    await sendPlainEmail(
      customer.email,
      `Worker assigned: ${booking.serviceTitle}`,
      html,
    );
    if (worker.emailAddress) {
      await sendPlainEmail(
        worker.emailAddress,
        `New job: ${booking.serviceTitle}`,
        workerHtml,
      );
    }
    return { success: true };
  },

  async sendWorkerAccountStatus(worker, status, reason = "") {
    const messages = {
      approved:
        "Your worker account has been approved. You can log in and accept jobs.",
      rejected: `Your application was rejected. ${reason}`,
      inactive:
        "Your account has been set to inactive. Contact support if this is unexpected.",
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

export const sendCustomerSignupEmailQueued = async (to, name) => {
  await addEmailJob({ type: "customer_signup", to, name });
};

export const sendWorkerPendingEmailQueued = async (to, name) => {
  await addEmailJob({ type: "worker_pending", to, name });
};

export const sendWorkerApprovedEmailQueued = async (to, name) => {
  await addEmailJob({ type: "worker_approved", to, name });
};

export const sendWorkerRejectedEmailQueued = async (to, name, reason) => {
  await addEmailJob({ type: "worker_rejected", to, name, reason });
};

export const sendBookingCreatedEmailQueued = async (to, name, bookingId) => {
  await addEmailJob({ type: "booking_created", to, name, bookingId });
};

export const sendBookingStatusEmailQueued = async (
  to,
  name,
  status,
  bookingId,
) => {
  await addEmailJob({ type: "booking_status", to, name, status, bookingId });
};
