/** Contextual skeletons — lightweight single-gradient shimmer (GPU-cheap). */

export function CardSkeleton() {
  return (
    <div className="rounded-3xl">
      <div className="skeleton aspect-[4/3] w-full rounded-3xl" />
      <div className="space-y-2 px-1.5 pt-3">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton h-3 w-1/2" />
        <div className="skeleton h-3 w-1/3" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function RailSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex gap-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-[260px] shrink-0">
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}

export function MenuSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-2xl p-3">
          <div className="flex-1 space-y-2.5 pt-1">
            <div className="skeleton size-4 rounded" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-3 w-1/4" />
            <div className="skeleton h-3 w-3/4" />
          </div>
          <div className="skeleton size-28 rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

export function RestaurantHeroSkeleton() {
  return (
    <div>
      <div className="skeleton h-56 w-full rounded-none md:h-80" />
      <div className="mx-auto max-w-5xl px-4">
        <div className="-mt-16 space-y-3 rounded-3xl glass p-6">
          <div className="skeleton h-7 w-1/3" />
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      </div>
      <div className="mx-auto mt-6 max-w-5xl px-4">
        <MenuSkeleton />
      </div>
    </div>
  );
}
