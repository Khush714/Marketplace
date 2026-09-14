"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: number;
  email: string;
  name: string;
  role: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export function AdminUsersScreen() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");

  async function load() {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    if (res.ok) setUsers(data.users);
    else setError(data.error ?? "Could not load operators");
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create operator");
      return;
    }
    setEmail("");
    setName("");
    setPassword("");
    setRole("operator");
    load();
  }

  async function update(id: number, patch: Record<string, unknown>) {
    await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    load();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
          Administration
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Operators</h1>
        <p className="mt-1 max-w-2xl text-white/45">
          Invite and manage people who can use the admin area. Only the owner can
          view or edit this page.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}

      {/* Create operator */}
      <section className="mt-8 rounded-3xl border border-white/8 bg-ink-850 p-6 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
        <h2 className="font-bold text-white">Add an operator</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Operator email"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Temporary password (min 8 chars)"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-ember-500/50 focus:bg-white/8"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-ember-500/50 [&>option]:bg-ink-900"
          >
            <option value="operator">Operator</option>
            <option value="support">Support</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button
          onClick={create}
          disabled={busy || !email || !password}
          className="mt-4 rounded-2xl bg-ember-500 px-5 py-2.5 text-sm font-bold text-ink-950 shadow-[0_8px_30px_rgba(255,122,26,0.3)] transition-all duration-200 hover:bg-ember-400 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add operator"}
        </button>
      </section>

      {/* List */}
      <section className="mt-8">
        {users === null ? (
          <p className="text-sm text-white/35">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-white/35">No operators yet.</p>
        ) : (
          <ul className="space-y-3">
            {users.map((u) => (
              <li
                key={u.id}
                className="card-lift flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/8 bg-ink-850 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{u.name || u.email}</span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/45">
                      {u.role}
                    </span>
                    {!u.active && (
                      <span className="rounded-full border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-white/45">{u.email}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <select
                    value={u.role}
                    onChange={(e) => update(u.id, { role: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-white outline-none sm:w-auto [&>option]:bg-ink-900"
                  >
                    <option value="operator">Operator</option>
                    <option value="support">Support</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    onClick={() => update(u.id, { active: !u.active })}
                    className={`rounded-lg px-2 py-1 font-semibold ${
                      u.active
                        ? "border border-rose-500/25 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                        : "border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => {
                      const p = window.prompt("New password (min 8 chars)");
                      if (p) update(u.id, { password: p });
                    }}
                    className="rounded-lg bg-white/5 px-2 py-1 font-semibold text-white/70 hover:bg-white/10"
                  >
                    Reset password
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
