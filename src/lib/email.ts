import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure:
      process.env.SMTP_SECURE === "1" ||
      process.env.SMTP_PORT === "465",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
  };
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    console.warn(
      `[email] SMTP not configured; skipping send to ${opts.to}. Set SMTP_HOST/SMTP_USER/SMTP_PASS in production.`,
    );
    return;
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transporter.sendMail({
    from: cfg.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

/** Branded OTP email body. */
export function otpEmailHtml(code: string): string {
  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px">Your sign-in code</h2>
      <p style="color:#475569;margin:0 0 20px">Use this code to sign in to the marketplace. It expires in 10 minutes.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#fff7ed;border:1px solid #ffedd5;border-radius:12px;padding:16px;text-align:center;color:#ea580c">${code}</div>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
}

export function sendOtpEmail(email: string, code: string): Promise<void> {
  return sendEmail({
    to: email,
    subject: "Your marketplace sign-in code",
    text: `Your sign-in code is ${code}. It expires in 10 minutes.`,
    html: otpEmailHtml(code),
  });
}
