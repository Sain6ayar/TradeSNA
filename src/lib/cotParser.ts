/**
 * CFTC Commitment of Traders parser.
 *
 * Ported from electron/cot.ts with the filesystem and database calls stripped
 * out, leaving pure functions. Imported by BOTH the browser (for parsing an
 * uploaded file) and the /api/cot-fetch serverless function (for the scheduled
 * download), so the two paths can never drift apart.
 */

export interface COTDataPoint {
    contract: string;
    category: string;
    net_current: number;
    net_pct_current: number;
    delta: number;
    is_flip: boolean;
    raw_longs: number;
    raw_shorts: number;
    oi: number;
    net_value_usd: number;
}

export interface COTReport {
    date: string;
    data: COTDataPoint[];
}

// EXPANDED TARGETS WITH CATEGORIES (Financials + Commodities)
export const TARGETS: Record<string, { name: string; size: number; cat: string }> = {
    // --- FOREX ---
    '098662': { name: 'USD Index', size: 1000, cat: 'Forex' },
    '099741': { name: 'EUR', size: 125000, cat: 'Forex' },
    '096742': { name: 'GBP', size: 62500, cat: 'Forex' },
    '097741': { name: 'JPY', size: 12500000, cat: 'Forex' },
    '090741': { name: 'CAD', size: 100000, cat: 'Forex' },
    '092741': { name: 'CHF', size: 125000, cat: 'Forex' },
    '232741': { name: 'AUD', size: 100000, cat: 'Forex' },
    '112741': { name: 'NZD', size: 100000, cat: 'Forex' },
    '095741': { name: 'MXN', size: 500000, cat: 'Forex' },
    '102741': { name: 'BRL', size: 100000, cat: 'Forex' },

    // --- INDICES ---
    '13874A': { name: 'S&P 500', size: 50, cat: 'Indices' },
    '209742': { name: 'NASDAQ 100', size: 20, cat: 'Indices' },
    '124603': { name: 'DJIA', size: 5, cat: 'Indices' },
    '1170E1': { name: 'VIX', size: 1000, cat: 'Indices' },

    // --- CRYPTO ---
    '133741': { name: 'Bitcoin', size: 5, cat: 'Crypto' },
    '146021': { name: 'Ether', size: 50, cat: 'Crypto' },

    // --- BONDS ---
    '043602': { name: '10Y Treasury', size: 100000, cat: 'Bonds' },
    '020601': { name: '30Y Treasury', size: 100000, cat: 'Bonds' },

    // --- COMMODITIES (From f_disagg) ---
    '088691': { name: 'Gold', size: 100, cat: 'Commodities' },
    '084691': { name: 'Silver', size: 5000, cat: 'Commodities' },
    '067651': { name: 'Crude Oil', size: 1000, cat: 'Commodities' },
    '002602': { name: 'Corn', size: 5000, cat: 'Commodities' },
    '005602': { name: 'Soybeans', size: 5000, cat: 'Commodities' },
    '001602': { name: 'Wheat', size: 5000, cat: 'Commodities' },
};

// COLUMN STRATEGIES
const COLUMNS_FIN = { OI: 7, LONG: 14, SHORT: 15, CHG_OI: 24, CHG_LONG: 31, CHG_SHORT: 32 };
const COLUMNS_COMM = { OI: 7, LONG: 12, SHORT: 13, CHG_OI: 24, CHG_LONG: 29, CHG_SHORT: 30 };

function parseNum(val: string | undefined): number {
    if (!val) return 0;
    const cleaned = val.replace(/\s/g, '').replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

export function parseLines(
    lines: Array<{ line: string; source: string }>,
    debugLog?: string[]
): COTDataPoint[] {
    const dataList: COTDataPoint[] = [];
    const auditTargets = ['098662', '001602']; // USD, Wheat

    for (const item of lines) {
        const cleanLine = item.line.replace(/"/g, '').trim();
        const parts = cleanLine.split(',');

        let foundId: string | null = null;
        for (const p of parts) {
            const pClean = p.trim();
            if (TARGETS[pClean]) { foundId = pClean; break; }
        }
        if (!foundId) continue;

        const meta = TARGETS[foundId];
        const cols = meta.cat === 'Commodities' ? COLUMNS_COMM : COLUMNS_FIN;

        if (debugLog && auditTargets.includes(foundId)) {
            debugLog.push(`\nAUDIT TARGET: ${meta.name} (${foundId})`);
            debugLog.push(`Source File: ${item.source}`);
            debugLog.push(`Column Strategy: ${meta.cat === 'Commodities'
                ? 'Managed Money [12,13]' : 'Leveraged Funds [14,15]'}`);
            if (parts[cols.LONG]) debugLog.push(`Raw Value Long (Idx ${cols.LONG}): ${parts[cols.LONG]}`);
            if (parts[cols.SHORT]) debugLog.push(`Raw Value Short (Idx ${cols.SHORT}): ${parts[cols.SHORT]}`);
        }

        const oi = parseNum(parts[cols.OI]);
        const longs = parseNum(parts[cols.LONG]);
        const shorts = parseNum(parts[cols.SHORT]);
        if (oi === 0) continue;

        const chgOi = parseNum(parts[cols.CHG_OI]);
        const chgLong = parseNum(parts[cols.CHG_LONG]);
        const chgShort = parseNum(parts[cols.CHG_SHORT]);

        const netPos = longs - shorts;
        const netValUsd = netPos * meta.size;
        const netPct = (netPos / oi) * 100;

        const prevOi = oi - chgOi;
        const prevLong = longs - chgLong;
        const prevShort = shorts - chgShort;
        const prevNet = prevLong - prevShort;
        const prevPct = prevOi !== 0 ? (prevNet / prevOi) * 100 : 0;
        const delta = netPct - prevPct;
        const isFlip = (netPos > 0 && prevNet < 0) || (netPos < 0 && prevNet > 0);

        dataList.push({
            contract: meta.name,
            category: meta.cat,
            net_current: Math.round(netPos),
            net_pct_current: Math.round(netPct * 10) / 10,
            delta: Math.round(delta * 10) / 10,
            is_flip: isFlip,
            raw_longs: longs,
            raw_shorts: shorts,
            oi,
            net_value_usd: netValUsd,
        });
    }

    return dataList;
}

/** Pulls the report date out of a CFTC CSV (column index 2). */
export function extractReportDate(content: string): string | null {
    for (const line of content.split('\n')) {
        const parts = line.split(',');
        if (parts.length > 3 && parts[2]?.includes('20')) {
            return parts[2].replace(/"/g, '').trim();
        }
    }
    return null;
}

/** Parses a single uploaded file into a report. */
export function parseFileContent(fileContent: string): COTReport {
    const lines = fileContent.split('\n').map((l) => ({ line: l, source: 'Uploaded File' }));
    const data = parseLines(lines);
    const date = extractReportDate(fileContent) || new Date().toISOString().split('T')[0];
    return { date, data };
}

export function getParserSourceCode(): string {
    return `
// === UNIFIED COT PARSER WITH AUDIT LOG ===
// Updated: 2026-02-08

const TARGETS = { ...Financials, ...Commodities };

// COLUMN MAPPING STRATEGY:
// 1. FINANCIALS (Forex, Indices, Bonds, Crypto) -> Leveraged Funds [14, 15]
// 2. COMMODITIES (Gold, Oil, Wheat) -> Managed Money [12, 13]
`;
}

export function debugSearchId(
    fileContent: string,
    targetId: string
): { found: boolean; rawLine: string; parsed: any } {
    for (const line of fileContent.split('\n')) {
        if (line.includes(targetId)) {
            return {
                found: true,
                rawLine: line.substring(0, 200) + '...',
                parsed: { id: targetId, note: 'See full audit log in Load Files' },
            };
        }
    }
    return { found: false, rawLine: 'NOT FOUND', parsed: null };
}
