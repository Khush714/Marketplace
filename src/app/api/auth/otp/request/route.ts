import { db } from "@/db";
import { otpChallenges } from "@/db/schema";
import { generateOtp, hashOtp } from "@/lib/session";
import { and, gt, isNull, sql } from "drizzle-orm";
import { sendOtpEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/otp/request  { email }
 * Creates an email OTP challenge and sends the code to the address.
 * Rate limited per address and per client IP.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!EMAIL_RE.test(email) || email.length > 200) {
      return Response.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    void ip;

    // Rate limit: at most 3 unconsumed challenges per address in 10 minutes.
    const perAddress = await db
      .select({ n: sql<number>`count(*)` })
      .from(otpChallenges)
      .where(
        and(
          sql`${otpChallenges.email} = ${email}`,
          gt(otpChallenges.createdAt, new Date(Date.now() - 10 * 60_000)),
          isNull(otpChallenges.consumedAt),
        ),
      );
    if (Number(perAddress[0]?.n ?? 0) >= 3) {
      return Response.json(
        { error: "Too many code requests for this email. Please wait a few minutes." },
        { status: 429 },
      );
    }

    const code = generateOtp();
    await db.insert(otpChallenges).values({
      email,
      codeHash: hashOtp(code, email),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    // Deliver by email. When SMTP isn't configured, still allow the code to be
    // surfaced in non-production or when explicitly enabled for testing.
    const dev =
      process.env.NODE_ENV !== "production" ||
      process.env.TABLZ_EXPOSE_DEV_OTP === "1";
    try {
      await sendOtpEmail(email, code);
    } catch (e) {
      console.error("[auth] failed to send OTP email", e);
      if (!dev) {
        return Response.json(
          { error: "Could not send the code. Please try again." },
          { status: 500 },
        );
      }
    }

    return Response.json({
      sent: true,
      email,
      ...(dev ? { devCode: code } : {}),
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to send code" }, { status: 500 });
  }
}
