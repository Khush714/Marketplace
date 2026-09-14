import { AdminHeader } from "@/components/admin/AdminHeader";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <AdminHeader />
      <div className="flex-1">{children}</div>
    </div>
  );
}
