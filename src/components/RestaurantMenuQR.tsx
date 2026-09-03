"use client";

import { QRCodeSVG } from "qrcode.react";

export function RestaurantMenuQR({
  url,
  restaurantName,
}: {
  url: string;
  restaurantName: string;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-5">
      <QRCodeSVG value={url} size={220} level="H" includeMargin />

      <p className="mt-4 text-sm font-semibold text-slate-900">
        Scan to order from {restaurantName}
      </p>

      <p className="mt-1 text-center text-xs text-slate-500">
        Opens the restaurant&apos;s existing online menu
      </p>
    </div>
  );
}
