import { NOINDEX } from "@/lib/seo";
import ConnectMerchantClient from "./connect-merchant-client";

// The OAuth callback carries a state value and a code challenge; keeping the
// referrer out of the headers stops those one-time values leaking to a page the
// browser navigates to next. NOINDEX comes from the shared crawl policy so this
// private route cannot drift from /robots.txt.
export const metadata = { ...NOINDEX, referrer: "no-referrer" as const };

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
