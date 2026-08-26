import { supabase, unwrap } from '../lib/supabase';
import {
    parseFileContent,
    parseLines,
    extractReportDate,
    getParserSourceCode,
    debugSearchId,
    type COTReport,
} from '../lib/cotParser';

/**
 * Commitment of Traders data.
 *
 * Desktop kept this in a cot_history.json file next to the SQLite database.
 * Here it lives in a shared `cot_reports` table: it's public market data, so
 * every signed-in user reads the same rows. Writes happen server-side only --
 * fetchLatest() calls a serverless function that holds the service-role key,
 * because the CFTC endpoints don't send CORS headers.
 */
function reportFromRow(row: any): COTReport | null {
    if (!row) return null;
    return { date: row.date, data: row.data };
}

export const cotApi = {
    getLatest: async (): Promise<COTReport | null> => {
        const row = unwrap(
            await supabase.from('cot_reports').select('*')
                .order('date', { ascending: false }).limit(1).maybeSingle()
        );
        return reportFromRow(row);
    },

    getHistory: async (limit: number = 10): Promise<COTReport[]> => {
        const rows = unwrap(
            await supabase.from('cot_reports').select('*')
                .order('date', { ascending: false }).limit(limit)
        ) as any[];
        return rows.map(reportFromRow).filter(Boolean) as COTReport[];
    },

    getHistoryDates: async (): Promise<string[]> => {
        const rows = unwrap(
            await supabase.from('cot_reports').select('date')
                .order('date', { ascending: false })
        ) as Array<{ date: string }>;
        return rows.map((r) => r.date);
    },

    getReportByDate: async (date: string): Promise<COTReport | null> => {
        const row = unwrap(
            await supabase.from('cot_reports').select('*').eq('date', date).maybeSingle()
        );
        return reportFromRow(row);
    },

    /** Triggers the server-side download from cftc.gov. */
    fetchLatest: async (): Promise<{ status: string; date: string; log: string[] }> => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const res = await fetch('/api/cot-fetch', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            return {
                status: 'ERROR',
                date: '',
                log: [`Fetch failed: ${res.status}`, detail],
            };
        }
        return res.json();
    },

    /** Parses a file the user uploaded in the COT debug panel. */
    parseFile: async (fileContent: string): Promise<COTReport> => parseFileContent(fileContent),

    getParserSource: async (): Promise<string> => getParserSourceCode(),

    debugSearchId: async (fileContent: string, targetId: string) =>
        debugSearchId(fileContent, targetId),

    /**
     * Parses the two CFTC snapshots bundled with the app (public/cot/*.txt),
     * standing in for the desktop build's Assets/ folder. Read-only: the
     * result is returned for display but not written to the shared table.
     */
    loadFromAssets: async (): Promise<{ report: COTReport; log: string[] }> => {
        const log: string[] = ['=== BUNDLED FILE LOAD LOG ==='];
        const files = [
            { url: '/cot/FinFutWk.txt', name: 'FinFutWk.txt' },
            { url: '/cot/f_disagg.txt', name: 'f_disagg.txt' },
        ];

        let combined: Array<{ line: string; source: string }> = [];
        let reportDate = '';

        for (const file of files) {
            try {
                const res = await fetch(file.url);
                if (!res.ok) { log.push(`ERROR: Could not find ${file.name}`); continue; }

                const content = await res.text();
                log.push(`SUCCESS: Loaded ${file.name} (${content.length} bytes)`);
                combined = combined.concat(
                    content.split('\n').map((l) => ({ line: l, source: file.name }))
                );
                if (!reportDate) reportDate = extractReportDate(content) || '';
            } catch (err: any) {
                log.push(`ERROR: Failed to load ${file.name}: ${err.message}`);
            }
        }

        const data = parseLines(combined, log);
        data.sort((a, b) => b.net_pct_current - a.net_pct_current);

        return {
            report: { date: reportDate || new Date().toISOString().split('T')[0], data },
            log,
        };
    },
};
