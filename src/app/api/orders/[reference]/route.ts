/** DEPRECATED — marketplace is discovery-only. */
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(
    { error: "Order tracking lives on the restaurant's own POS." },
    { status: 410 },
  );
}
