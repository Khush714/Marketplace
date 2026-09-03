import { db } from "@/db";
import { otpChallenges } from "@/db/schema";
import { generateOtp, hashOtp } from "@/lib/session";
import { and, gt, isNull, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/otp/request  { phone }
 * Creates an OTP challenge. In production the code would be delivered via SMS;
 * during development we return it in the response so the flow is testable
 * without a real gateway.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = String(body.phone ?? "").trim();
    if (!/^[+\d\s()-]{6,20}$/.test(phone)) {
      return Response.json({ error: "Enter a valid phone number." }, { status: 400 });
    }

    // Rate limit: at most 3 unconsumed challenges in the last 10 minutes.
    const recent = await db
      .select({ n: sql<number>`count(*)` })
      .from(otpChallenges)
      .where(
        and(
          sql`${otpChallenges.phone} = ${phone}`,
          gt(otpChallenges.createdAt, new Date(Date.now() - 10 * 60_000)),
          isNull(otpChallenges.consumedAt),
        ),
      );
    if (Number(recent[0]?.n ?? 0) >= 3) {
      return Response.json(
        { error: "Too many code requests. Please wait a few minutes." },
        { status: 429 },
      );
    }

    const code = generateOtp();
    await db.insert(otpChallenges).values({
      phone,
      codeHash: hashOtp(code, phone),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });

    // NEVER return the code in a real production deployment. Sandbox testing
    // can opt in via TABLZ_EXPOSE_DEV_OTP=1 in .env.
    const dev =
      process.env.NODE_ENV !== "production" ||
      process.env.TABLZ_EXPOSE_DEV_OTP === "1";
    return Response.json({
      sent: true,
      phone,
      ...(dev ? { devCode: code } : {}),
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Failed to send code" }, { status: 500 });
  }
}
