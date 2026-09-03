"use client";

import type { PublicPhotos } from "@/lib/marketplace";

export function RestaurantPhotos({ data }: { data: PublicPhotos }) {
  return (
    <section id="photos" className="scroll-mt-24">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">Photos</h2>
      <p className="mt-1 text-sm text-slate-500">
        From the POS menu — {data.photos.length} images, no second gallery database.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.photos.map((p, i) => (
          <figure
            key={`${p.url}-${i}`}
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={p.caption}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-105"
            />
            <figcaption className="px-3 py-2 text-xs font-medium text-slate-600">
              {p.caption}
              <span className="ml-1 text-[10px] text-slate-400">
                {p.source === "cover" ? "• cover" : "• dish"}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
