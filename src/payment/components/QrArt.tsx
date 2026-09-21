import { memo, useMemo } from "react";
import { buildQrMatrix, matrixToPath } from "../lib/qr";

/**
 * Static QR geometry. Memoised on the payload so React never re-renders or
 * animates the modules themselves — only the light around them moves.
 */
function QrArtBase({ payload }: { payload: string }) {
  const { path, size } = useMemo(() => {
    const matrix = buildQrMatrix(payload, 33);
    return { path: matrixToPath(matrix), size: matrix.size };
  }, [payload]);

  return (
    <svg
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      className="h-full w-full"
      shapeRendering="crispEdges"
      role="img"
      aria-label="UPI payment QR code"
    >
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#f7f7f5" rx={1.5} />
      <path d={path} fill="#0b0b0c" />
    </svg>
  );
}

export default memo(QrArtBase);
