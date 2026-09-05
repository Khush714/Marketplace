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
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-orange-500">
          Administration
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Operators</h1>
        <p className="mt-1 max-w-2xl text-slate-500">
          Invite and manage people who can use the admin area. Only the owner can
          view or edit this page.
        </p>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>
      )}

      {/* Create operator */}
      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-bold text-slate-900">Add an operator</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Operator email"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="Temporary password (min 8 chars)"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
          >
            <option value="operator">Operator</option>
            <option value="support">Support</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button
          onClick={create}
          disabled={busy || !email || !password}
          className="mt-4 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add operator"}
        </button>
      </section>

      {/* List */}
      <section className="mt-8">
        {users === null ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-slate-400">No operators yet.</p>
        ) : (
          <ul className="space-y-3">
            {users.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{u.name || u.email}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      {u.role}
                    </span>
                    {!u.active && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-rose-600">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-slate-500">{u.email}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <select
                    value={u.role}
                    onChange={(e) => update(u.id, { role: e.target.value })}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 outline-none"
                  >
                    <option value="operator">Operator</option>
                    <option value="support">Support</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    onClick={() => update(u.id, { active: !u.active })}
                    className={`rounded-lg px-2 py-1 font-semibold ${
                      u.active
                        ? "bg-rose-50 text-rose-600 hover:bg-rose-100"
                        : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                    }`}
                  >
                    {u.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => {
                      const p = window.prompt("New password (min 8 chars)");
                      if (p) update(u.id, { password: p });
                    }}
                    className="rounded-lg bg-slate-100 px-2 py-1 font-semibold text-slate-600 hover:bg-slate-200"
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
