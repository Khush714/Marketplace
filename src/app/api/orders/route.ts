/** DEPRECATED — marketplace is discovery-only. Use restaurant menu_url. */
export const dynamic = "force-dynamic";
export async function POST() {
  return Response.json(
    { error: "Marketplace does not create orders." },
    { status: 410 },
  );
}
