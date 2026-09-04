"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

export function AdminHeader() {
  const pathname = usePathname();
  if (pathname === "/admin/login") return null;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/admin" className="font-bold tracking-tight">
          🛡️ Admin
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Link
            href="/"
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-50"
          >
            Storefront
          </Link>
          <AdminLogoutButton />
        </div>
      </div>
    </header>
  );
}
