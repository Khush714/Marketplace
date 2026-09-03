import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchScreen } from "@/components/SearchScreen";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <Suspense>
      <SearchScreen />
    </Suspense>
  );
}
