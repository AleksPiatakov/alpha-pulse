import { NextResponse } from "next/server";
import { createAiExplanations } from "@/lib/ai-explanations";
import { scanTechnicalPlans } from "@/lib/market-scan";

export async function GET(request: Request) {
  try {
    const { plans, recommended24h, watchedScenarios, watchStatusCounts, recommended24hComplete, entryHorizonHours, scanned, eligible, analyzed, covered, batchSize, scanConcurrency, deepScannedInSweep, selectionDiagnostics, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted, freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds, batchDurationMs, priorityRechecked } = await scanTechnicalPlans();
    // Fast default response: do not block each market scan behind a potentially
    // 20-second external AI request. AI enrichment remains opt-in.
    const ai = new URL(request.url).searchParams.get("explain") === "1"
      ? await createAiExplanations(plans.slice(0, 6))
      : {explanations: {} as Record<string, Pick<(typeof plans)[number], "summary" | "caution" | "nextStep">>,
          status: {state: "skipped" as const, code: "FAST_SCAN", message: "Швидке сканування; AI-пояснення доступні за запитом."}};
    const enrichedPlans = plans.map((plan) =>
      ai.explanations[plan.id]
        ? { ...plan, ...ai.explanations[plan.id], explanationSource: "ai" as const }
        : plan
    );
    return NextResponse.json({
      success: true, scanned, eligible, analyzed, covered, batchSize, scanConcurrency, deepScannedInSweep, selectionDiagnostics, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted, freshChecked, staleChecked, failedChecked, unchecked, oldestCheckedAgeSeconds, batchDurationMs, priorityRechecked,
      plans: enrichedPlans, recommended24h, watchedScenarios, watchStatusCounts, recommended24hComplete, entryHorizonHours,
      aiStatus: ai.status,
      generatedAt: new Date().toISOString(),
    });
  } catch (caught) {
    return NextResponse.json({
      success: false,
      error: caught instanceof Error ? caught.message : "Помилка сканування.",
    }, { status: 502 });
  }
}
