import {
  phases,
  capabilityMatrix,
  baselineChecklist,
  apiInventory,
  profileDecisions,
  reviewDecisions,
  redactionRules,
  type ReuseLevel,
  type SchemaDecision,
} from "@/lib/roadmap";

export const dynamic = "force-static";

const reuseStyle: Record<ReuseLevel, string> = {
  reuse: "bg-emerald-500/10 text-emerald-400",
  extend: "bg-amber-500/10 text-amber-400",
  new: "bg-sky-500/10 text-sky-400",
};

const stateStyle: Record<string, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10",
  active: "border-ember-500/40 bg-ember-500/10",
  next: "border-white/8 bg-ink-850",
};

export default function RoadmapPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ember-400">
          Marketplace roadmap
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">
          Building on top of the POS — safely.
        </h1>
        <p className="mt-2 max-w-2xl text-white/45">
          The marketplace ships in controlled phases. Every phase produces
          something testable, and nothing about the existing POS core is broken
          along the way. This page is the living Phase 0 &amp; Phase 1
          deliverable.
        </p>
      </div>

      {/* Phases */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        {phases.map((p) => (
          <div
            key={p.id}
            className={`rounded-2xl border p-5 ${stateStyle[p.state]}`}
          >
            <div className="flex items-center justify-between">
              <span className="rounded-lg bg-white/10 px-2 py-0.5 text-xs font-bold text-white/80">
                {p.id}
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide text-white/45">
                {p.state}
              </span>
            </div>
            <h2 className="mt-3 font-semibold text-white">{p.title}</h2>
            <p className="mt-1 text-sm text-white/45">{p.goal}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-white/55">
              {p.points.map((pt) => (
                <li key={pt} className="flex gap-2">
                  <span className="text-ember-500">▸</span>
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Baseline checklist */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-white">Phase 0 — Baseline regression checklist</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {baselineChecklist.map((c) => (
            <div
              key={c.label}
              className="flex items-center gap-3 rounded-2xl border border-white/8 bg-ink-850 px-4 py-3 text-sm"
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-xs text-white ${
                  c.status === "pass" ? "bg-emerald-500" : "bg-white/15"
                }`}
              >
                {c.status === "pass" ? "✓" : "·"}
              </span>
              <span className="text-white/55">{c.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Capability matrix */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-white">
          Phase 1 — Requirement → POS capability map
        </h2>
        <p className="mt-1 text-sm text-white/45">
          For each marketplace need we decide: reuse the POS as-is, extend it, or
          build new.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-white/5 text-left text-xs uppercase tracking-wide text-white/40">
                <th className="px-4 py-3">Requirement</th>
                <th className="px-4 py-3">Existing POS capability</th>
                <th className="px-4 py-3">Table(s)</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3">Modification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 bg-ink-850">
              {capabilityMatrix.map((row) => (
                <tr key={row.requirement}>
                  <td className="px-4 py-3 font-medium text-white">
                    {row.requirement}
                  </td>
                  <td className="px-4 py-3 text-white/55">
                    {row.posCapability}
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/80">
                      {row.table}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reuseStyle[row.reuse]}`}
                    >
                      {row.reuse}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/55">{row.modification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phase 2 data model */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-white">
          Phase 2 — Marketplace data model rulings
        </h2>
        <p className="mt-1 text-sm text-white/45">
          Every proposed field was checked against the existing POS first.{" "}
          <strong>existed</strong> = already in the POS, not duplicated.{" "}
          <strong>moved</strong> = relocated off the POS table because it is a
          marketplace-only concern. <strong>added</strong> = genuinely new.
        </p>
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <DecisionTable
            title="restaurant_marketplace_profiles"
            rows={profileDecisions}
          />
          <DecisionTable title="reviews (extended in place)" rows={reviewDecisions} />
        </div>
      </section>

      {/* Phase 3 redaction rules */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-white">
          Phase 3 — Customer-safe API contract
        </h2>
        <p className="mt-1 text-sm text-white/45">
          Public endpoints are built from an explicit allowlist and every
          response is passed through <code>assertCustomerSafe()</code>, which
          fails the request if an internal key ever appears. Run the gate live at{" "}
          <a
            href="/api/marketplace/audit"
            className="font-medium text-ember-400 hover:text-ember-300"
          >
            /api/marketplace/audit
          </a>
          .
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8 bg-ink-850">
          <table className="w-full min-w-[520px] text-sm">
            <tbody className="divide-y divide-white/6">
              {redactionRules.map((r) => (
                <tr key={r.concern}>
                  <td className="w-56 px-4 py-2.5 font-medium text-white">
                    {r.concern}
                  </td>
                  <td className="px-4 py-2.5 text-white/55">{r.enforced}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* API inventory */}
      <section className="mt-12">
        <h2 className="text-xl font-semibold text-white">Recorded API endpoints</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-white/8 bg-ink-850">
          <table className="w-full min-w-[640px] text-sm">
            <tbody className="divide-y divide-white/6">
              {apiInventory.map((a) => (
                <tr key={a.path}>
                  <td className="w-16 px-4 py-3">
                    <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-bold text-white/80">
                      {a.method}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white/55">
                    {a.path}
                  </td>
                  <td className="px-4 py-3 text-white/45">{a.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const verdictStyle: Record<SchemaDecision["verdict"], string> = {
  existed: "bg-emerald-500/10 text-emerald-400",
  moved: "bg-violet-500/10 text-violet-400",
  added: "bg-sky-500/10 text-sky-400",
};

function DecisionTable({
  title,
  rows,
}: {
  title: string;
  rows: SchemaDecision[];
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 bg-ink-850">
      <div className="border-b border-white/6 bg-white/5 px-4 py-3">
        <code className="text-xs font-semibold text-white/55">{title}</code>
      </div>
      <table className="w-full min-w-[480px] text-sm">
        <tbody className="divide-y divide-white/6">
          {rows.map((r) => (
            <tr key={r.field}>
              <td className="px-4 py-2.5 align-top font-mono text-xs text-white">
                {r.field}
              </td>
              <td className="px-2 py-2.5 align-top">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${verdictStyle[r.verdict]}`}
                >
                  {r.verdict}
                </span>
              </td>
              <td className="px-4 py-2.5 align-top text-xs text-white/45">
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
