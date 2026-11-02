export type MarketplaceFulfillmentDestination = "merchant" | "pos" | "none";

export function selectMarketplaceFulfillment(input: {
  posReady: boolean;
  merchantReady: boolean;
}): MarketplaceFulfillmentDestination {
  if (input.merchantReady) return "merchant";
  return input.posReady ? "pos" : "none";
}
