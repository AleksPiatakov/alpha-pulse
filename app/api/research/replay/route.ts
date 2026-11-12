import { NextResponse } from "next/server";
import { compareFrozenMarketPlan } from "@/lib/snapshot-parity";
import { verifyMarketInputSnapshot, type SealedMarketInputSnapshot } from "@/lib/market-input-snapshot";

const MAX_JSON_BYTES = 1_000_000;
/**
 * POST a previously exported {snapshot,sha256} object to reproduce a fixed
 * research evaluation. Does not fetch Bybit or place/save any trade/order.
 */
export async function POST(request: Request) {
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_JSON_BYTES)
    return NextResponse.json({success:false,error:"Знімок перевищує 1 МБ."},{status:413});
  try {
    const document = JSON.parse(bodyText) as Record<string,unknown>;
    const candidate = (document.snapshot && document.sha256
      ? document : document.sealed) as SealedMarketInputSnapshot | undefined;
    if (!candidate || !verifyMarketInputSnapshot(candidate))
      return NextResponse.json({success:false,error:"Знімок невалідний або SHA-256 не збігається."},{status:422});
    const parity = compareFrozenMarketPlan(candidate, null);
    return NextResponse.json({
      success:true, sealedHash:candidate.sha256, symbol:candidate.snapshot.symbol,
      tickerReference:parity.tickerReference,
      closeReference:parity.closeReference,
      closeModeDifferences:parity.closeModeDifferences,
      caveat:"Історична симуляція виконання та результатів угод не виконується. Жодних нових запитів до біржі.",
    },{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({success:false,error:"Невірний JSON."},{status:400});
  }
}
