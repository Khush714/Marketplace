const Bar = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-full bg-slate-200 ${className}`} />
);

const Circle = ({ className = "" }: { className?: string }) => (
  <div className={`animate-pulse rounded-full bg-slate-200 ${className}`} />
);

function RestaurantSkeleton() {
  return (
    <section className="flex flex-col items-center text-center">
      <Circle className="h-16 w-16 border-4 border-white shadow-md" />
      <Bar className="mt-3 h-4 w-36" />
      <div className="mt-2 flex items-center gap-2">
        <Bar className="h-3 w-24" />
        <Circle className="h-5 w-5" />
      </div>
    </section>
  );
}

function StatusHeroSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-center">
        <Bar className="mx-auto h-7 w-40" />
        <Bar className="mx-auto mt-2 h-4 w-64 max-w-full" />
      </div>
      <div className="mt-5 flex justify-center gap-2">
        <Circle className="h-6 w-20" />
        <Circle className="h-6 w-16" />
      </div>
    </section>
  );
}

function ProgressRailSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between px-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Circle className="h-5 w-5" />
            <Bar className="h-2.5 w-10" />
          </div>
        ))}
      </div>
    </section>
  );
}

function StepperSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-3">
          <Circle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="flex-1">
            <Bar className="h-4 w-28" />
            {i < 2 && <Bar className="mt-1.5 h-3 w-16" />}
          </div>
        </div>
      ))}
    </section>
  );
}

function TimelineSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <Bar className="mb-4 h-3.5 w-28" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <Circle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <Bar className="h-3.5 w-24" />
            <Bar className="mt-1 h-2.5 w-16" />
          </div>
        </div>
      ))}
    </section>
  );
}

function DetailsSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <Bar className="h-3.5 w-20" />
        <Bar className="h-3 w-24" />
      </div>
      <div className="mt-4 space-y-3">
        <Bar className="h-4 w-48" />
        <Bar className="h-4 w-36" />
        <Bar className="h-4 w-40" />
      </div>
      <div className="my-4 border-t border-slate-100" />
      <div className="space-y-2">
        <div className="flex justify-between">
          <Bar className="h-3 w-16" />
          <Bar className="h-3 w-10" />
        </div>
        <div className="flex justify-between">
          <Bar className="h-3 w-14" />
          <Bar className="h-3 w-10" />
        </div>
        <div className="flex justify-between">
          <Bar className="h-3.5 w-12" />
          <Bar className="h-3.5 w-14" />
        </div>
      </div>
    </section>
  );
}

function PaymentSkeleton() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <Circle className="h-9 w-9" />
        <div className="flex-1">
          <Bar className="h-4 w-20" />
          <Bar className="mt-1.5 h-3 w-28" />
        </div>
        <Bar className="h-6 w-16" />
      </div>
    </section>
  );
}

export function OrderSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <RestaurantSkeleton />
      <StatusHeroSkeleton />
      <ProgressRailSkeleton />
      <StepperSkeleton />
      <TimelineSkeleton />
      <DetailsSkeleton />
      <PaymentSkeleton />
    </div>
  );
}
