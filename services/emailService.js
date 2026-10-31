import handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../utils/logger.js";
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
  /** Email/password signup verification only */
  async sendEmailVerificationCode(user, code) {
    const email = user.email || user.emailAddress;
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

  /** Worker account created directly by an admin (not self-signup) */
  async sendWorkerAccountCreated(worker, plainPassword) {
    const html = `
      <p>Hi ${worker.fullName || "there"},</p>
      <p>An account has been created for you on Fix It Now as a worker.</p>
      <p><strong>Email:</strong> ${worker.email}<br/>
      <strong>Temporary password:</strong> ${plainPassword}</p>
      <p>Please log in and change your password as soon as possible.</p>
      <p>If you weren't expecting this, please contact support.</p>
    `;
    return sendPlainEmail(
      worker.email,
      "Fix It Now — your worker account is ready",
      html,
    );
  },

  /** Worker account approved by admin */
  async sendWorkerApproval(worker) {
    return sendTemplatedEmail(
      worker.email,
      "Your Worker Application Has Been Approved!",
      "worker-approved",
      {
        fullName: worker.fullName,
        email: worker.email,
        appUrl: env.FRONTEND_URL,
      },
    );
  },

  /** Booking confirmation email. Excludes address, phone, notes, and payment data. */
  async sendBookingConfirmed(booking) {
    const to = String(booking?.email || booking?.customerId?.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return { success: false, skipped: true, error: "No valid customer email available" };
    }
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
    const reference = String(booking?._id || "").slice(-8).toUpperCase();
    const serviceTitle = escapeHtml(booking?.serviceTitle || "your requested service");
    const customerName = escapeHtml(booking?.customerName || "there");
    const confirmedAt = booking?.assignedAt || booking?.updatedAt || new Date();
    const confirmationDate = new Date(confirmedAt).toLocaleString("en-PK", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Karachi",
    });
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:600px;margin:auto">
        <h2 style="color:#0B1F3A">Your booking is confirmed</h2>
        <p>Hi ${customerName},</p>
        <p>Good news — your Fix It Now booking has been confirmed and a worker has been assigned.</p>
        <div style="background:#f5f7fa;border-radius:10px;padding:16px;margin:20px 0">
          <p style="margin:0 0 8px"><strong>Booking reference:</strong> #${escapeHtml(reference)}</p>
          <p style="margin:0 0 8px"><strong>Service:</strong> ${serviceTitle}</p>
          <p style="margin:0 0 8px"><strong>Status:</strong> Confirmed</p>
          <p style="margin:0"><strong>Confirmed on:</strong> ${escapeHtml(confirmationDate)} (Pakistan time)</p>
        </div>
        <p>Keep your booking reference for any questions. You can check the latest progress in Fix It Now.</p>
        <p>If you did not request this booking or need help, please contact Fix It Now support.</p>
        <p>Thank you for choosing Fix It Now.</p>
      </div>
    `;
    return sendPlainEmail(to, `Fix It Now — booking confirmed (#${reference})`, html);
  },

  /** Worker account rejected by admin */
  async sendWorkerRejection(worker, reason) {
    const html = `
      <p>Hi ${worker.fullName || "there"},</p>
      <p>Thank you for applying to join Fix It Now as a worker. After review, we're unable to approve your application at this time.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
      <p>If you believe this is a mistake or would like more information, please contact support.</p>
    `;
    return sendPlainEmail(
      worker.email,
      "Fix It Now — worker application update",
      html,
    );
  },

  /** Account disabled by admin */
  async sendAccountDisabled(worker) {
    const html = `
      <p>Hi ${worker.fullName},</p>
      <p>Your Fix It Now worker account has been disabled by an administrator.</p>
      <p>If you believe this is a mistake, please contact support.</p>
    `;
    return sendPlainEmail(
      worker.email,
      "Fix It Now — account disabled",
      html,
    );
  },

  /** Account deleted by admin */
  async sendAccountDeleted(worker) {
    const html = `
      <p>Hi ${worker.fullName},</p>
      <p>Your Fix It Now worker account has been deleted.</p>
      <p>If you need assistance, please contact support.</p>
    `;
    return sendPlainEmail(
      worker.email,
      "Fix It Now — account deleted",
      html,
    );
  },
};

export default emailService;
