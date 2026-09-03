/** DEPRECATED — marketplace no longer stores customer orders. */
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    { error: "Order history is kept by each restaurant's POS." },
    { status: 410 },
  );
}
