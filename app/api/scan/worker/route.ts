import { NextResponse } from "next/server";
import { scanTechnicalPlans } from "@/lib/market-scan";

// Same scanner state as /api/scan in the local Next.js process, without AI calls.
// Only metadata is returned: this endpoint does not expose plans or credentials.
export async function GET() {
  try {
    const { scanned, eligible, analyzed, covered, category, rejectionCounts,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted } = await scanTechnicalPlans();
    return NextResponse.json({
      success: true, scanned, eligible, analyzed, covered, category,
      universePages, universeInstruments, unsupportedInstruments,
      coveragePercent, cycleCompleted, rejectionCounts,
      generatedAt: new Date().toISOString(),
    });
  } catch (caught) {
    return NextResponse.json({
      success: false,
      error: caught instanceof Error ? caught.message : "Помилка сканування.",
    }, { status: 502 });
  }
}
