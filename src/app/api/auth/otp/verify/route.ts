import { db } from "@/db";
import { otpChallenges, customers } from "@/db/schema";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { hashOtp, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/otp/verify  { phone, code, name? }
 * Verifies the OTP, finds or creates a customer, sets the session cookie.
 * The customer directory here is the SAME `customers` table the POS uses —
 * no second identity store.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const phone = String(body.phone ?? "").trim();
    const code = String(body.code ?? "").trim();
    const name = String(body.name ?? "").trim();

    if (!phone || !code) {
      return Response.json({ error: "Phone and code are required." }, { status: 400 });
    }

    const [challenge] = await db
      .select()
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.phone, phone),
          isNull(otpChallenges.consumedAt),
          gt(otpChallenges.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);

    if (!challenge) {
      return Response.json(
        { error: "Code expired. Please request a new one." },
        { status: 400 },
      );
    }
    if (challenge.attempts >= 5) {
      return Response.json(
        { error: "Too many attempts. Please request a new code." },
        { status: 429 },
      );
    }

    const expected = hashOtp(code, phone);
    if (expected !== challenge.codeHash) {
      await db
        .update(otpChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(otpChallenges.id, challenge.id));
      return Response.json({ error: "Incorrect code." }, { status: 400 });
    }

    // Mark used
    await db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));

    // Find or create customer by phone (unique constraint enforces this).
    const [existing] = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.phone, phone))
      .limit(1);

    let customerId: number;
    if (existing) {
      customerId = existing.id;
      if (name && name !== existing.name) {
        await db.update(customers).set({ name }).where(eq(customers.id, customerId));
      }
    } else {
      const [created] = await db
        .insert(customers)
        .values({ name: name || "Guest", phone })
        .returning({ id: customers.id });
      customerId = created.id;
    }

    await setSessionCookie(customerId);
    return Response.json({ ok: true, customerId });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Verification failed" }, { status: 500 });
  }
}
