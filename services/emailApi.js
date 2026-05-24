import logger from "../utils/logger.js";
import env from "../utils/env.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** True when Resend API key is set (Railway-friendly; no SMTP ports). */
export function isEmailConfigured() {
  return Boolean(String(env.RESEND_API_KEY || "").trim());
}

export function getFromAddress() {
  const name = env.EMAIL_FROM_NAME || "Fix It Now";
  const email = env.EMAIL_FROM || "onboarding@resend.dev";
  return `${name} <${email}>`;
}

/**
 * Send transactional email via Resend HTTP API.
 * @see https://resend.com/docs/api-reference/emails/send-email
 */
export async function sendEmail({ to, subject, html }) {
  if (!to) {
    return { success: false, error: "Missing recipient" };
  }

  if (!isEmailConfigured()) {
    if (env.NODE_ENV === "development") {
      logger.info("Email skipped (RESEND_API_KEY not set)", { to, subject });
      return { success: true, skipped: true };
    }
    return { success: false, error: "Email API not configured (set RESEND_API_KEY)" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: getFromAddress(),
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        body?.message ||
        body?.error ||
        (typeof body === "string" ? body : response.statusText);
      logger.warn("Resend API rejected email", {
        to,
        subject,
        status: response.status,
        message,
      });
      return { success: false, error: message };
    }

    logger.info("Email sent via Resend", { to, subject, id: body?.id });
    return { success: true, id: body?.id };
  } catch (error) {
    logger.warn("Email send failed", { to, subject, error: error.message });
    return { success: false, error: error.message };
  }
}

/** Log configuration status once on startup. */
export function logEmailServiceStatus() {
  if (isEmailConfigured()) {
    logger.info("Email service ready (Resend API)", {
      from: getFromAddress(),
    });
    console.log("Email service ready (Resend API)");
    return;
  }

  const hint =
    env.NODE_ENV === "production"
      ? "Set RESEND_API_KEY and EMAIL_FROM on Railway"
      : "Set RESEND_API_KEY in .env to send emails in development";

  logger.warn("Email service not configured — transactional emails disabled", {
    hint,
  });
  if (env.NODE_ENV === "production") {
    console.warn("EMAIL NOT CONFIGURED:", hint);
  }
}
