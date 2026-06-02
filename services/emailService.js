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

  /** Worker account approved by admin */
  async sendWorkerApproval(worker) {
    return sendTemplatedEmail(
      worker.emailAddress,
      "Your Worker Application Has Been Approved!",
      "worker-approved",
      {
        fullName: worker.fullName,
        email: worker.emailAddress,
        appUrl: env.FRONTEND_URL,
      },
    );
  },

  /** Account disabled, deleted, or status change */
  async sendWorkerAccountStatus(worker, status, reason = "") {
    const messages = {
      inactive:
        "Your account has been set to inactive. Contact support if this is unexpected.",
      active: "Your worker account is active again.",
      deleted: "Your worker account has been deleted from Fix It Now.",
      disabled: "Your worker account has been disabled.",
    };
    const html = `<p>Hi ${worker.fullName},</p><p>${messages[status] || reason || `Account status: ${status}`}</p>`;
    return sendPlainEmail(
      worker.emailAddress,
      `Fix It Now — account update`,
      html,
    );
  },
};

export default emailService;
