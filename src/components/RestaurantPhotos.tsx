"use client";

import type { PublicPhotos } from "@/lib/marketplace";

export function RestaurantPhotos({ data }: { data: PublicPhotos }) {
  return (
    <section id="photos" className="scroll-mt-24">
      <h2 className="text-lg font-semibold tracking-tight text-white">Photos</h2>
      <p className="mt-1 text-sm text-white/45">
        From the POS menu — {data.photos.length} images, no second gallery database.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data.photos.map((p, i) => (
          <figure
            key={`${p.url}-${i}`}
            className="group overflow-hidden rounded-2xl border border-white/8 bg-ink-850 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] transition-colors hover:border-white/15"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={p.caption}
              loading="lazy"
              className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-105"
            />
            <figcaption className="px-3 py-2 text-xs font-medium text-white/70">
              {p.caption}
              <span className="ml-1 text-[10px] text-white/30">
                {p.source === "cover" ? "• cover" : "• dish"}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}