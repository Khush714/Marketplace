/**
 * Deterministic QR-style matrix builder.
 *
 * The geometry is generated once from the payload string and then treated as
 * immutable — the visual language of the checkout animates the *environment*
 * around the code, never the code itself.
 */

export type QrMatrix = {
  size: number;
  cells: boolean[][];
};

/** xorshift32 — tiny deterministic PRNG so the same payload always renders identically. */
function makeRng(seed: number) {
  let s = seed || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function placeFinder(cells: boolean[][], row: number, col: number) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= cells.length || cc >= cells.length) continue;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      cells[rr][cc] = inside ? onBorder || inCore : false;
    }
  }
}

function placeAlignment(cells: boolean[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= cells.length || cc >= cells.length) continue;
      const ring = Math.max(Math.abs(r), Math.abs(c));
      cells[rr][cc] = ring !== 1;
    }
  }
}

function isReserved(size: number, r: number, c: number) {
  const finder = (fr: number, fc: number) =>
    r >= fr - 1 && r <= fr + 7 && c >= fc - 1 && c <= fc + 7;
  if (finder(0, 0) || finder(0, size - 7) || finder(size - 7, 0)) return true;
  if (r === 6 || c === 6) return true; // timing
  const ar = size - 7;
  const ac = size - 7;
  if (r >= ar - 2 && r <= ar + 2 && c >= ac - 2 && c <= ac + 2) return true;
  return false;
}

export function buildQrMatrix(payload: string, size = 33): QrMatrix {
  const rng = makeRng(hash(payload));
  const cells: boolean[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => false),
  );

  // data field — pseudo-random but stable, with light clustering so it reads
  // like a genuine encoded payload rather than TV static.
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isReserved(size, r, c)) continue;
      const neighbour = (r > 0 && cells[r - 1][c] ? 0.14 : 0) + (c > 0 && cells[r][c - 1] ? 0.1 : 0);
      cells[r][c] = rng() < 0.44 + neighbour;
    }
  }

  // timing patterns
  for (let i = 0; i < size; i++) {
    cells[6][i] = i % 2 === 0;
    cells[i][6] = i % 2 === 0;
  }

  placeFinder(cells, 0, 0);
  placeFinder(cells, 0, size - 7);
  placeFinder(cells, size - 7, 0);
  placeAlignment(cells, size - 7, size - 7);

  // dark module
  cells[size - 8][8] = true;

  return { size, cells };
}

/** Collapses the matrix into a single SVG path — one DOM node, pin-sharp edges. */
export function matrixToPath(matrix: QrMatrix): string {
  const { size, cells } = matrix;
  let d = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (cells[r][c]) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return d;
}
