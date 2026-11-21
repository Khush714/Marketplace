import ConnectMerchantClient from "./connect-merchant-client";

export const metadata = { referrer: "no-referrer" as const };

export default async function ConnectMerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; code_challenge?: string }>;
}) {
  const params = await searchParams;
  return (
    <ConnectMerchantClient
      state={params.state ?? ""}
      codeChallenge={params.code_challenge ?? ""}
    />
  );
}
