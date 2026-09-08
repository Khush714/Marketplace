import type { Metadata } from "next";
import { NotificationsScreen } from "@/components/NotificationsScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return <NotificationsScreen />;
}