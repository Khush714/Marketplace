"use client";

import { useCallback, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

export function RestaurantMenuQR({
  url,
  restaurantName,
  uploadedQrUrl,
}: {
  url: string;
  restaurantName: string;
  /** Owner-uploaded image of their POS menu QR. Shown first when present. */
  uploadedQrUrl?: string | null;
}) {
  const [mode, setMode] = useState<"uploaded" | "stable">(
    uploadedQrUrl ? "uploaded" : "stable",
  );
  const wrapperRef = useRef<HTMLDivElement>(null);

  const download = useCallback(() => {
    const svgEl = wrapperRef.current?.querySelector("svg");
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const padding = 80;
      const canvas = document.createElement("canvas");
      canvas.width = img.width + padding * 2;
      canvas.height = img.height + padding * 2 + 72;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, padding, padding);

      ctx.fillStyle = "#1e293b";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(restaurantName, canvas.width / 2, padding + img.height + 36);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "14px sans-serif";
      ctx.fillText("Scan to order", canvas.width / 2, padding + img.height + 58);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${restaurantName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-menu-qr.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }, "image/png");

      URL.revokeObjectURL(svgUrl);
    };
    img.src = svgUrl;
  }, [restaurantName]);

  const showUploaded = Boolean(uploadedQrUrl) && mode === "uploaded";

  return (
    <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-5">
      {showUploaded ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={uploadedQrUrl as string}
            alt={`Menu QR code for ${restaurantName}`}
            className="h-[220px] w-[220px] rounded-xl border border-slate-200 bg-white object-contain"
          />

          <p className="mt-4 text-sm font-semibold text-slate-900">
            Scan to order from {restaurantName}
          </p>

          <p className="mt-1 text-center text-xs text-slate-500">
            Menu QR code provided by the restaurant
          </p>

          <button
            type="button"
            onClick={() => setMode("stable")}
            className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            USE PERMANENT QR INSTEAD
          </button>
        </>
      ) : (
        <>
          <div ref={wrapperRef}>
            <QRCodeSVG value={url} size={220} level="H" includeMargin />
          </div>

          <p className="mt-4 text-sm font-semibold text-slate-900">
            Scan to order from {restaurantName}
          </p>

          <p className="mt-1 text-center text-xs text-slate-500">
            Opens the restaurant&apos;s existing online menu
          </p>

          <button
            type="button"
            onClick={download}
            className="mt-4 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            DOWNLOAD QR
          </button>

          {uploadedQrUrl && (
            <button
              type="button"
              onClick={() => setMode("uploaded")}
              className="mt-2 rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              SHOW RESTAURANT&apos;S QR
            </button>
          )}
        </>
      )}
    </div>
  );
}