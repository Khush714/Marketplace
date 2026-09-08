import { placeOrder } from "@/lib/marketplace";
import { safeJson, errorJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await placeOrder(body);

    if (!result.ok) {
      return errorJson(result.error, result.status);
    }

    return safeJson(result, 201);
  } catch (e) {
    console.error("POST /api/orders", e);
    return errorJson("Failed to place order", 500);
  }
}
