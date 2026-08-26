/**
 * Derived trade metrics.
 *
 * Ported verbatim from electron/db/trades.ts so the web app produces
 * byte-identical numbers to the desktop app. In the desktop build this ran in
 * the main process on every insert/update; here it runs client-side before the
 * row goes to Postgres.
 *
 * Returns null for any metric that cannot be computed (missing data or a
 * division by zero).
 */
export function computeTradeMetrics(trade: {
    direction: string;
    entryPrice?: number | null;
    exitPrice?: number | null;
    initialSL?: number | null;
    maePrice?: number | null;
    mfePrice?: number | null;
}) {
    const dir = trade.direction === 'Short' ? -1 : 1;
    const entry = trade.entryPrice ?? null;
    const exit = trade.exitPrice ?? null;
    const sl = trade.initialSL ?? null;
    const mae = trade.maePrice ?? null;
    const mfe = trade.mfePrice ?? null;

    const riskDenom = (entry != null && sl != null) ? Math.abs(entry - sl) : null;

    // Heat % = (MAE - Entry) / (SL - Entry)  [direction-aware]
    let heatPercent: number | null = null;
    if (mae != null && entry != null && sl != null) {
        const denom = (sl - entry) * dir;
        if (denom !== 0) heatPercent = ((mae - entry) * dir) / denom;
    }

    // MFE R = (MFE - Entry) / |Entry - SL|
    let mfeR: number | null = null;
    if (mfe != null && entry != null && riskDenom && riskDenom !== 0) {
        mfeR = ((mfe - entry) * dir) / riskDenom;
    }

    // MAE R = (MAE - Entry) / |Entry - SL|  (negative = drawdown)
    let maeR: number | null = null;
    if (mae != null && entry != null && riskDenom && riskDenom !== 0) {
        maeR = ((mae - entry) * dir) / riskDenom;
    }

    // Profit Capture % = (Exit - Entry) / (MFE - Entry)
    let profitCapturePercent: number | null = null;
    if (exit != null && entry != null && mfe != null) {
        const denom = (mfe - entry) * dir;
        if (denom !== 0) profitCapturePercent = ((exit - entry) * dir) / denom;
    }

    return { heatPercent, mfeR, maeR, profitCapturePercent };
}

/** Seconds between entry and exit, or null when either side is missing. */
export function computeDurationSeconds(
    entryDateTime?: string | null,
    exitTime?: string | null
): number | null {
    if (!entryDateTime || !exitTime) return null;
    const start = new Date(entryDateTime).getTime();
    const end = new Date(exitTime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.max(0, (end - start) / 1000);
}
