import type { Metadata } from "next";
import { AdminUsersScreen } from "@/components/admin/AdminUsersScreen";

export const metadata: Metadata = { title: "Operators" };

export default function AdminUsersPage() {
  return <AdminUsersScreen />;
}
