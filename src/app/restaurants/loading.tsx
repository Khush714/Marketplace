import { CardGridSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-6 md:px-6 md:pt-9">
      <div className="skeleton h-4 w-24" />
      <div className="skeleton mt-3 h-9 w-72 max-w-full" />
      <div className="skeleton mt-3 h-4 w-48" />
      <div className="mt-6 flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-9 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-8">
        <CardGridSkeleton />
      </div>
    </div>
  );
}
