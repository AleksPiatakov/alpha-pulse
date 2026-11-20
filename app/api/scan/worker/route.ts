import { NextResponse } from "next/server";
import { scanTechnicalPlans } from "@/lib/market-scan";
import {dispatchTelegramAlerts} from "@/lib/telegram-ready-notifier";

// Same scanner state as /api/scan in the local Next.js process, without AI calls.
// Only metadata is returned: this endpoint does not expose plans or credentials.
export async function GET() {
  try {
    const { recommended24h, scanned, eligible, analyzed, covered, watchStatusCounts, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted, completedSweeps, freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds, batchDurationMs, priorityRechecked, scanRevision, scanCompletedAt } = await scanTechnicalPlans();
    // Opt-in, read-only notification flow: NEVER places a trade.
    // A Telegram failure must not make the market worker look like a failed scan.
    let telegram={enabled:false,sent:0,errors:0};
    try{telegram=await dispatchTelegramAlerts(recommended24h);}
    catch(err){
      telegram={enabled:true,sent:0,errors:1};
      console.warn("Telegram alert dispatcher unavailable:",err instanceof Error?err.message:"error");
    }
    return NextResponse.json({
      telegram,
      success: true, scanned, eligible, analyzed, covered, watchStatusCounts, category,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted, completedSweeps, freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds, batchDurationMs, priorityRechecked, scanRevision, scanCompletedAt, rejectionCounts,
      generatedAt: new Date().toISOString(),
    });
  } catch (caught) {
    return NextResponse.json({
      success: false,
      error: caught instanceof Error ? caught.message : "Помилка сканування.",
    }, { status: 502 });
  }
}
