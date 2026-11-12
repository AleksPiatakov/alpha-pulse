import { NextResponse } from "next/server";
import { captureAndEvaluateMarketSnapshot } from "@/lib/market-scan";

/**
 * Explicit on-demand research export; no writes and no order placement.
 * Never expose account information or API credentials.
 */
export async function GET(request: Request) {
  const symbol = (new URL(request.url).searchParams.get("symbol") ?? "").toUpperCase();
  if (!/^[A-Z0-9]{3,24}USDT$/.test(symbol))
    return NextResponse.json({success:false,error:"Некоректний символ."},{status:400});
  try {
    const result = await captureAndEvaluateMarketSnapshot(symbol);
    return NextResponse.json({
      success:true, ...result,
      notice:"Це знімок поточного Bybit Demo, не історичне підтвердження переваги та не дозвіл на ордер.",
    }, {headers:{"Cache-Control":"no-store"}});
  } catch (caught) {
    return NextResponse.json({
      success:false,
      error:caught instanceof Error ? caught.message : "Не вдалося створити знімок.",
    },{status:502,headers:{"Cache-Control":"no-store"}});
  }
}
