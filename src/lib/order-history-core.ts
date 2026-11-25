/** Bounded, pure pagination and filtering for order history. */

export const DEFAULT_HISTORY_LIMIT = 12;
export const MAX_HISTORY_LIMIT = 60;
export const HISTORY_STATUSES = ["all", "live", "completed", "cancelled"] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export interface HistoryQuery {
  limit: number;
  offset: number;
  status: HistoryStatus;
  q: string;
  from: string;
  to: string;
}

export interface HistoryPage<T> {
  orders: T[];
  nextOffset: number | null;
}

type ParamReader = { get(name: string): string | null };

function boundedInt(raw: string | null, fallback: number, max: number): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) return fallback;
  return Math.max(0, Math.min(max, Number(raw)));
}

function validDay(raw: string | null): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

export function parseHistoryQuery(params: ParamReader): HistoryQuery {
  const status = params.get("status") ?? "all";
  const limit = boundedInt(params.get("limit"), DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT) || DEFAULT_HISTORY_LIMIT;
  return {
    limit,
    offset: boundedInt(params.get("offset"), 0, 10_000),
    status: (HISTORY_STATUSES as readonly string[]).includes(status) ? (status as HistoryStatus) : "all",
    q: (params.get("q") ?? "").trim().slice(0, 64).toLowerCase(),
    from: validDay(params.get("from")),
    to: validDay(params.get("to")),
  };
}

const COMPLETED_STAGES = new Set(["delivered", "collected"]);
const CANCELLED_STAGES = new Set(["cancelled", "rejected"]);

export interface HistoryOrderLike {
  code: string;
  createdAt: string;
  restaurantName: string;
  status: { stageKey: string };
  items: readonly { name: string }[];
}

/** Pure filter applied after the bounded DB read; a bad filter never widens access. */
export function filterHistory<T extends HistoryOrderLike>(rows: readonly T[], query: HistoryQuery): T[] {
  return rows.filter((row) => {
    if (query.status === "live" && (COMPLETED_STAGES.has(row.status.stageKey) || CANCELLED_STAGES.has(row.status.stageKey))) return false;
    if (query.status === "completed" && !COMPLETED_STAGES.has(row.status.stageKey)) return false;
    if (query.status === "cancelled" && !CANCELLED_STAGES.has(row.status.stageKey)) return false;
    if (query.from && row.createdAt.slice(0, 10) < query.from) return false;
    if (query.to && row.createdAt.slice(0, 10) > query.to) return false;
    if (query.q) {
      const haystack = [row.code, row.restaurantName, ...row.items.map((item) => item.name)]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query.q)) return false;
    }
    return true;
  });
}

export function paginateHistory<T>(rows: readonly T[], query: HistoryQuery): HistoryPage<T> {
  const page = rows.slice(query.offset, query.offset + query.limit);
  const nextOffset = query.offset + page.length < rows.length ? query.offset + page.length : null;
  return { orders: page, nextOffset };
}
