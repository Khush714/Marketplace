"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

export function AdminHeader() {
  const pathname = usePathname();
  if (pathname === "/admin/login") return null;

  return (
    <header className="sticky top-0 z-50 border-b border-white/8 bg-ink-900/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/admin" className="font-bold tracking-tight text-white">
          🛡️ Admin
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <Link
            href="/"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-semibold text-white/70 transition-colors hover:bg-white/10"
          >
            Storefront
          </Link>
          <AdminLogoutButton />
        </div>
      </div>
    </header>
  );
}
