import { createClient } from '@supabase/supabase-js';
import { parseLines, extractReportDate } from '../src/lib/cotParser';

/**
 * Downloads the latest Commitment of Traders reports from cftc.gov, parses
 * them, and upserts the result into the shared `cot_reports` table.
 *
 * This has to run server-side for two reasons: cftc.gov sends no CORS headers,
 * and writing to the shared table requires the service-role key, which must
 * never reach the browser.
 */
const URLS = {
    fin: 'https://www.cftc.gov/dea/newcot/FinFutWk.txt',
    comm: 'https://www.cftc.gov/dea/newcot/f_disagg.txt',
};

export const config = { maxDuration: 60 };

export default async function handler(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return json({ status: 'ERROR', date: '', log: ['Server is missing Supabase credentials.'] }, 500);
    }

    // Only signed-in users may trigger a refresh.
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) return json({ status: 'ERROR', date: '', log: ['Not signed in.'] }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData?.user) {
        return json({ status: 'ERROR', date: '', log: ['Invalid session.'] }, 401);
    }

    const log: string[] = ['=== AUTOMATED FETCH LOG ==='];

    try {
        log.push(`Fetching Financials from ${URLS.fin}...`);
        const finRes = await fetch(URLS.fin);
        if (!finRes.ok) throw new Error(`Fin fetch failed: ${finRes.statusText}`);
        const finContent = await finRes.text();

        log.push(`Fetching Commodities from ${URLS.comm}...`);
        const commRes = await fetch(URLS.comm);
        if (!commRes.ok) throw new Error(`Comm fetch failed: ${commRes.statusText}`);
        const commContent = await commRes.text();

        const date = extractReportDate(finContent) || new Date().toISOString().split('T')[0];
        log.push(`Detected Report Date: ${date}`);

        const data = parseLines([
            ...finContent.split('\n').map((line) => ({ line, source: 'Downloaded Financials' })),
            ...commContent.split('\n').map((line) => ({ line, source: 'Downloaded Commodities' })),
        ], log);

        data.sort((a, b) => b.net_pct_current - a.net_pct_current);
        log.push(`Parsed ${data.length} contracts.`);

        const { data: existing } = await admin
            .from('cot_reports').select('data').eq('date', date).maybeSingle();

        let status = 'SAVED';
        if (existing) {
            if (JSON.stringify(existing.data) === JSON.stringify(data)) {
                log.push('Data already exists and matches. Up to date.');
                return json({ status: 'UP_TO_DATE', date, log });
            }
            status = 'UPDATED';
            log.push('Data for date exists but differs. Overwriting.');
        } else {
            log.push('New data saved to history.');
        }

        const { error: writeError } = await admin
            .from('cot_reports')
            .upsert({ date, data, fetched_at: new Date().toISOString() }, { onConflict: 'date' });
        if (writeError) throw new Error(writeError.message);

        return json({ status, date, log });
    } catch (err: any) {
        log.push(`CRITICAL ERROR: ${err.message}`);
        return json({ status: 'ERROR', date: '', log }, 200);
    }
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
