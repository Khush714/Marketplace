import "server-only";
import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { integrationAudit, restaurants } from "@/db/schema";
import { escapeLike } from "@/lib/abuse-core";

export interface AuditQuery {
  limit: number;
  offset: number;
  actor: string;
  event: string;
  restaurantId: number | null;
}

export type AuditRow = {
  id: number;
  restaurantId: number | null;
  restaurantSlug: string | null;
  actor: string;
  event: string;
  detail: unknown;
  ipAddress: string | null;
  createdAt: string;
};

export async function listAuditRows(query: AuditQuery): Promise<AuditRow[]> {
  const where: SQL[] = [];
  if (query.actor) where.push(eq(integrationAudit.actor, query.actor));
  if (query.event) where.push(ilike(integrationAudit.event, `%${escapeLike(query.event)}%`));
  if (query.restaurantId !== null) where.push(eq(integrationAudit.restaurantId, query.restaurantId));
  const rows = await db
    .select({
      id: integrationAudit.id,
      restaurantId: integrationAudit.restaurantId,
      restaurantSlug: restaurants.slug,
      actor: integrationAudit.actor,
      event: integrationAudit.event,
      detail: integrationAudit.detail,
      ipAddress: integrationAudit.ipAddress,
      createdAt: integrationAudit.createdAt,
    })
    .from(integrationAudit)
    .leftJoin(restaurants, eq(integrationAudit.restaurantId, restaurants.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(integrationAudit.createdAt), desc(integrationAudit.id))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export const AUDIT_ACTORS = ["restaurant", "partner", "system", "ops"] as const;
export function parseAuditActor(raw: string | null): string {
  return raw && (AUDIT_ACTORS as readonly string[]).includes(raw) ? raw : "";
}
