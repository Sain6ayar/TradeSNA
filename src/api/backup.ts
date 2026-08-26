import { supabase, requireUserId, unwrap } from '../lib/supabase';

/**
 * Backup export / import.
 *
 * This is also the migration path off the desktop app: a backup written by
 * Electron's "Export Data" drops straight in here. To keep that working in
 * both directions the on-disk JSON keeps the ORIGINAL SQLite shape --
 * snake_case columns, 0/1 integers for booleans, and JSON-encoded strings for
 * array columns -- even though Postgres stores those natively.
 */

const CHUNK = 500;

function toJsonText(v: any, fallback: string): string {
    if (v === null || v === undefined) return fallback;
    return typeof v === 'string' ? v : JSON.stringify(v);
}

function toJsonValue(v: any, fallback: any): any {
    if (v === null || v === undefined) return fallback;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return fallback; }
}

/** SQLite wrote 0/1; Postgres wants a real boolean. Accept either. */
function toBool(v: any): boolean {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
    return false;
}

function numOrNull(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
}

/**
 * Upserts in batches. `onConflict` is passed explicitly rather than relying on
 * PostgREST's default: every table here has a COMPOSITE primary key, and
 * naming the columns removes any doubt about which one it targets.
 */
async function insertChunked(table: string, rows: any[], onConflict: string): Promise<number> {
    let written = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const batch = rows.slice(i, i + CHUNK);
        unwrap(await supabase.from(table).upsert(batch, { onConflict }) as any);
        written += batch.length;
    }
    return written;
}

export interface ImportSummary {
    accounts: number;
    trades: number;
    journal: number;
    settings: number;
    importProfiles: number;
    weeklyReviews: number;
}

export const backupApi = {
    /** Builds the backup payload in desktop-compatible shape. */
    buildExport: async (): Promise<any> => {
        const userId = await requireUserId();

        const pull = async (table: string) =>
            unwrap(await supabase.from(table).select('*').eq('user_id', userId)) as any[];

        const [trades, journal, settings, accounts, importProfiles, weeklyReviews] =
            await Promise.all([
                pull('trades'), pull('journal_entries'), pull('settings'),
                pull('accounts'), pull('import_profiles'), pull('weekly_reviews'),
            ]);

        const strip = (row: any) => { const { user_id, ...rest } = row; return rest; };

        const enrichedTrades = trades.map((t: any) => {
            const row = strip(t);

            // Backfill duration and win exactly as the desktop exporter did.
            if ((!row.duration_seconds || row.duration_seconds === 0)
                && row.entry_date_time && row.exit_time) {
                const start = new Date(row.entry_date_time).getTime();
                const end = new Date(row.exit_time).getTime();
                row.duration_seconds = Math.max(0, (end - start) / 1000);
            }
            const pnl = row.pnl || 0;
            if (pnl > 0) row.win = 1;
            else if (pnl < 0) row.win = 0;
            else row.win = toBool(row.win) ? 1 : 0;

            // Re-encode jsonb columns as the strings SQLite held.
            row.confluences = toJsonText(row.confluences, '[]');
            row.tags = toJsonText(row.tags, '[]');
            row.mistakes = toJsonText(row.mistakes, '[]');
            row.images = toJsonText(row.images, '[]');
            row.image_annotations = toJsonText(row.image_annotations, '{}');
            row.meta = toJsonText(row.meta, '{}');

            // Fields the desktop exporter dropped.
            delete row.emotion_pre;
            delete row.emotion_post;
            delete row.tilt_score;
            delete row.session;

            return row;
        });

        return {
            version: 1,
            timestamp: new Date().toISOString(),
            trades: enrichedTrades,
            journal: journal.map((j: any) => ({ ...strip(j), tags: toJsonText(j.tags, '[]') })),
            settings: settings.map((s: any) => strip(s)),
            accounts: accounts.map((a: any) => ({
                ...strip(a), is_aggregated: toBool(a.is_aggregated) ? 1 : 0,
            })),
            importProfiles: importProfiles.map((p: any) => ({
                ...strip(p), column_mappings: toJsonText(p.column_mappings, '{}'),
            })),
            weeklyReviews: weeklyReviews.map((r: any) => ({
                ...strip(r), json_data: toJsonText(r.json_data, 'null'),
            })),
        };
    },

    /** Prompts a file download of the current account's data. */
    exportData: async (): Promise<boolean> => {
        const data = await backupApi.buildExport();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `tradeslate_backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        return true;
    },

    /** Loads a backup object into the signed-in user's account. */
    restore: async (backup: any): Promise<ImportSummary> => {
        const userId = await requireUserId();
        const summary: ImportSummary = {
            accounts: 0, trades: 0, journal: 0,
            settings: 0, importProfiles: 0, weeklyReviews: 0,
        };

        // --- 1. Accounts -------------------------------------------------
        const knownAccountIds = new Set<string>();
        if (Array.isArray(backup.accounts)) {
            const rows = backup.accounts.map((a: any) => {
                knownAccountIds.add(a.id);
                return {
                    user_id: userId,
                    id: a.id,
                    name: a.name ?? a.id,
                    is_aggregated: a.is_aggregated === undefined ? true : toBool(a.is_aggregated),
                    color: a.color ?? null,
                    created_at: a.created_at || new Date().toISOString(),
                };
            });
            summary.accounts = await insertChunked('accounts', rows, 'user_id,id');
        }

        // --- 2. Accounts referenced by trades but absent above ------------
        // The desktop importer auto-created these; the composite foreign key
        // makes it mandatory here, or the trade insert would fail.
        if (Array.isArray(backup.trades)) {
            const missing = new Map<string, any>();
            for (const t of backup.trades) {
                const accId = t.account_id;
                if (accId && !knownAccountIds.has(accId) && !missing.has(accId)) {
                    missing.set(accId, {
                        user_id: userId,
                        id: accId,
                        name: accId,
                        is_aggregated: true,
                        color: '#3b82f6',
                        created_at: new Date().toISOString(),
                    });
                    knownAccountIds.add(accId);
                }
            }
            if (missing.size) {
                summary.accounts += await insertChunked('accounts', [...missing.values()], 'user_id,id');
            }
        }

        // --- 3. Trades ---------------------------------------------------
        if (Array.isArray(backup.trades)) {
            const rows = backup.trades.map((t: any) => ({
                user_id: userId,
                id: t.id,
                account_id: t.account_id || null,
                market: t.market,
                direction: t.direction,
                entry_date_time: t.entry_date_time,
                exit_time: t.exit_time || null,
                setup: t.setup ?? null,
                entry_trigger: t.entry_trigger ?? null,
                confluences: toJsonValue(t.confluences, []),
                entry_price: numOrNull(t.entry_price),
                exit_price: numOrNull(t.exit_price),
                planned_sl: numOrNull(t.planned_sl),
                initial_sl: numOrNull(t.initial_sl ?? t.planned_sl),
                planned_tp: numOrNull(t.planned_tp),
                contracts: numOrNull(t.contracts),
                risk: numOrNull(t.risk),
                pnl: numOrNull(t.pnl),
                planned_rr: numOrNull(t.planned_rr),
                achieved_r: numOrNull(t.achieved_r),
                win: toBool(t.win),
                duration_seconds: numOrNull(t.duration_seconds),
                mae_price: numOrNull(t.mae_price),
                mfe_price: numOrNull(t.mfe_price),
                heat_percent: numOrNull(t.heat_percent),
                mfe_r: numOrNull(t.mfe_r),
                mae_r: numOrNull(t.mae_r),
                profit_capture_percent: numOrNull(t.profit_capture_percent),
                notes_raw: t.notes_raw ?? null,
                notes_clean: t.notes_clean ?? null,
                ai_verdict: t.ai_verdict ?? null,
                emotion_pre: t.emotion_pre ?? null,
                emotion_post: t.emotion_post ?? null,
                tilt_score: numOrNull(t.tilt_score),
                session: t.session ?? null,
                tags: toJsonValue(t.tags, []),
                mistakes: toJsonValue(t.mistakes, []),
                images: toJsonValue(t.images, []),
                image_annotations: toJsonValue(t.image_annotations, {}),
                video_url: t.video_url ?? null,
                meta: toJsonValue(t.meta, {}),
                status: t.status || 'CLOSED',
                created_at: t.created_at || new Date().toISOString(),
                updated_at: t.updated_at || new Date().toISOString(),
            }));
            summary.trades = await insertChunked('trades', rows, 'user_id,id');
        }

        // --- 4. Journal --------------------------------------------------
        if (Array.isArray(backup.journal)) {
            // Collapse duplicate dates -- the (user_id, date) unique index
            // would otherwise reject the whole batch.
            const byDate = new Map<string, any>();
            for (const j of backup.journal) {
                byDate.set(j.date, {
                    user_id: userId,
                    id: j.id || crypto.randomUUID(),
                    date: j.date,
                    content: j.content ?? null,
                    mood: j.mood ?? null,
                    tags: toJsonValue(j.tags, []),
                    created_at: j.created_at || new Date().toISOString(),
                    updated_at: j.updated_at || new Date().toISOString(),
                });
            }
            const rows = [...byDate.values()];
            for (let i = 0; i < rows.length; i += CHUNK) {
                unwrap(await supabase.from('journal_entries')
                    .upsert(rows.slice(i, i + CHUNK), { onConflict: 'user_id,date' }) as any);
            }
            summary.journal = rows.length;
        }

        // --- 5. Settings -------------------------------------------------
        if (Array.isArray(backup.settings)) {
            const rows = backup.settings.map((s: any) => ({
                user_id: userId,
                key: s.key,
                value: s.value ?? null,
            }));
            summary.settings = await insertChunked('settings', rows, 'user_id,key');
        }

        // --- 6. Import profiles ------------------------------------------
        if (Array.isArray(backup.importProfiles)) {
            const rows = backup.importProfiles.map((p: any) => ({
                user_id: userId,
                id: p.id,
                name: p.name,
                type: p.type || 'custom',
                column_mappings: toJsonValue(p.column_mappings, {}),
                date_format: p.date_format ?? null,
                delimiter: p.delimiter || ',',
                created_at: p.created_at || new Date().toISOString(),
                updated_at: p.updated_at || new Date().toISOString(),
            }));
            summary.importProfiles = await insertChunked('import_profiles', rows, 'user_id,id');
        }

        // --- 7. Weekly reviews -------------------------------------------
        if (Array.isArray(backup.weeklyReviews)) {
            const rows = backup.weeklyReviews.map((r: any) => ({
                user_id: userId,
                id: r.id,
                week_label: r.week_label ?? null,
                start_date: r.start_date ?? null,
                end_date: r.end_date ?? null,
                json_data: toJsonValue(r.json_data, null),
                created_at: r.created_at || new Date().toISOString(),
                updated_at: r.updated_at || new Date().toISOString(),
            }));
            summary.weeklyReviews = await insertChunked('weekly_reviews', rows, 'user_id,id');
        }

        return summary;
    },

    /** Prompts for a backup file and restores it. Returns false if cancelled. */
    importData: async (): Promise<boolean> => {
        const file = await new Promise<File | null>((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json,.json';
            input.style.display = 'none';
            document.body.appendChild(input);

            let settled = false;
            const finish = (f: File | null) => {
                if (settled) return;
                settled = true;
                input.remove();
                resolve(f);
            };

            input.onchange = () => finish(input.files?.[0] ?? null);
            input.oncancel = () => finish(null);
            input.click();
        });

        if (!file) return false;

        const backup = JSON.parse(await file.text());
        const summary = await backupApi.restore(backup);

        console.log('Backup restored:', summary);
        return true;
    },
};
