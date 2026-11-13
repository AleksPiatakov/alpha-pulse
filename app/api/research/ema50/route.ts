import {NextResponse} from "next/server";
import {getEmaStudy, type EmaStudyPeriod, EMA50_CUTOFF} from "@/lib/video-ema50-history";
import {replayVideoEma50} from "@/lib/video-ema50-backtest";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const allowed=new Set([120,365]);
export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const symbol=(params.get("symbol")||"").toUpperCase();
  const days=Number(params.get("days")||"120");
  if(!/^[A-Z0-9]{3,24}USDT$/.test(symbol)||!allowed.has(days))
    return NextResponse.json({success:false,error:"Потрібна пара USDT і період 120 або 365 днів."},{status:400});
  try{
    const snapshot=await getEmaStudy(symbol,days as EmaStudyPeriod);
    const data=snapshot.candles;
    const models=(["video-3r","comparison-2r"] as const).flatMap(model=>
      (["reference","conservative"] as const).map(costMode=>
        replayVideoEma50(symbol,data["15"],data["60"],data["240"],model,costMode)));
    return NextResponse.json({success:true,symbol,days,cutoff:EMA50_CUTOFF,
      snapshotSha256:snapshot.sha256,source:snapshot.source,
      volatilityAnnualizedPct:models[0]?.volatilityAnnualizedPct??null,
      models,researchOnly:true,autoOrders:false,
      note:"Поточна група волатильності визначається за фактичними годинними доходностями. Це дослідницький тест, не незалежний holdout.",
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return NextResponse.json({success:false,error:error instanceof Error?error.message:"Помилка історичного тесту."},
      {status:502,headers:{"Cache-Control":"no-store"}});
  }
}
