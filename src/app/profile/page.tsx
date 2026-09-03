import type { Metadata } from "next";
import { ProfileScreen } from "@/components/ProfileScreen";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProfileScreen />;
}
