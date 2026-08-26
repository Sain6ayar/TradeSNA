import { supabase, requireUserId, unwrap } from '../lib/supabase';
import { computeTradeMetrics, computeDurationSeconds } from '../lib/tradeMetrics';
import type { Trade } from '../types';

/**
 * Row <-> Trade mapping.
 *
 * Mirrors electron/db/trades.ts. The one structural difference: columns that
 * were JSON-encoded TEXT in SQLite are real jsonb here, so they arrive already
 * parsed -- but we still guard, because rows imported from a desktop backup
 * can carry either shape.
 */
function asArray(v: any): any[] {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } }
    return [];
}

function asObject(v: any): any {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
    return {};
}

export function fromRow(row: any): Trade {
    return {
        id: row.id,
        accountId: row.account_id,
        market: row.market,
        direction: row.direction as 'Long' | 'Short',
        entryDateTime: row.entry_date_time,
        exitTime: row.exit_time,
        entryPrice: row.entry_price,
        exitPrice: row.exit_price,
        contracts: row.contracts,
        plannedSL: row.planned_sl,
        initialSL: row.initial_sl,
        plannedTP: row.planned_tp,
        risk: row.risk,
        pnl: row.pnl,
        plannedRR: row.planned_rr,
        achievedR: row.achieved_r,
        setup: row.setup,
        entryTrigger: row.entry_trigger,
        confluences: asArray(row.confluences),
        notesRaw: row.notes_raw,
        notesClean: row.notes_clean,
        aiVerdict: row.ai_verdict,
        emotionPre: row.emotion_pre,
        emotionPost: row.emotion_post,
        tiltScore: row.tilt_score,
        maePrice: row.mae_price,
        mfePrice: row.mfe_price,
        heatPercent: row.heat_percent ?? null,
        mfeR: row.mfe_r ?? null,
        maeR: row.mae_r ?? null,
        profitCapturePercent: row.profit_capture_percent ?? null,
        durationSeconds: row.duration_seconds,
        win: Boolean(row.win),
        tags: asArray(row.tags),
        mistakes: asArray(row.mistakes),
        session: row.session,
        status: row.status as any,
        images: asArray(row.images),
        imageAnnotations: asObject(row.image_annotations),
        videoUrl: row.video_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        meta: asObject(row.meta),
    } as Trade;
}

/** Trade -> DB row. `userId` is stamped on by the caller. */
function toRow(t: Trade, userId: string) {
    const metrics = computeTradeMetrics(t);
    return {
        user_id: userId,
        id: t.id,
        account_id: t.accountId || null,
        market: t.market,
        direction: t.direction,
        entry_date_time: t.entryDateTime,
        exit_time: t.exitTime || null,
        entry_price: t.entryPrice,
        exit_price: t.exitPrice ?? null,
        contracts: t.contracts,
        planned_sl: t.plannedSL || null,
        initial_sl: t.initialSL || null,
        planned_tp: t.plannedTP || null,
        risk: t.risk || null,
        pnl: t.pnl ?? null,
        planned_rr: t.plannedRR || null,
        achieved_r: t.achievedR || null,
        setup: t.setup || null,
        entry_trigger: t.entryTrigger || null,
        confluences: t.confluences || [],
        notes_raw: t.notesRaw || null,
        notes_clean: t.notesClean || null,
        ai_verdict: t.aiVerdict || null,
        emotion_pre: t.emotionPre || null,
        emotion_post: t.emotionPost || null,
        tilt_score: t.tiltScore || null,
        mae_price: t.maePrice || null,
        mfe_price: t.mfePrice || null,
        heat_percent: metrics.heatPercent ?? null,
        mfe_r: metrics.mfeR ?? null,
        mae_r: metrics.maeR ?? null,
        profit_capture_percent: metrics.profitCapturePercent ?? null,
        duration_seconds: t.durationSeconds || computeDurationSeconds(t.entryDateTime, t.exitTime),
        // Matches desktop: an explicit win flag wins, else derive from PnL.
        win: t.win ? true : ((t.pnl ?? 0) > 0),
        tags: t.tags || [],
        mistakes: t.mistakes || [],
        session: t.session || null,
        status: t.status || 'CLOSED',
        images: t.images || [],
        image_annotations: t.imageAnnotations || {},
        video_url: t.videoUrl || null,
        meta: t.meta || {},
        updated_at: new Date().toISOString(),
    };
}

// PostgREST caps a single response at 1000 rows by default; page through so a
// long-running journal doesn't silently truncate.
const PAGE = 1000;

export const tradesApi = {
    getAll: async (accountId?: string): Promise<Trade[]> => {
        const userId = await requireUserId();
        const out: Trade[] = [];

        for (let from = 0; ; from += PAGE) {
            let q = supabase
                .from('trades')
                .select('*')
                .eq('user_id', userId)
                .order('entry_date_time', { ascending: false })
                .range(from, from + PAGE - 1);

            if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);

            const rows = unwrap(await q) as any[];
            out.push(...rows.map(fromRow));
            if (rows.length < PAGE) break;
        }

        return out;
    },

    getRaw: async (id: string): Promise<any> => {
        const userId = await requireUserId();
        return unwrap(
            await supabase.from('trades').select('*')
                .eq('user_id', userId).eq('id', id).maybeSingle()
        );
    },

    create: async (tradeData: Omit<Trade, 'id' | 'createdAt' | 'updatedAt'>): Promise<Trade> => {
        const userId = await requireUserId();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const { confluences, tags, mistakes, images, ...rest } = tradeData as any;

        const fullTrade: Trade = {
            id,
            accountId: (tradeData as any).accountId || 'main-account',
            confluences: confluences || [],
            tags: tags || [],
            mistakes: mistakes || [],
            images: images || [],
            createdAt: now,
            updatedAt: now,
            ...rest,
        };

        const row = { ...toRow(fullTrade, userId), created_at: now, updated_at: now };
        const saved = unwrap(
            await supabase.from('trades').insert(row).select().single()
        );
        return fromRow(saved);
    },

    update: async (id: string, tradeData: Partial<Trade>): Promise<Trade | null> => {
        const userId = await requireUserId();

        const existing = unwrap(
            await supabase.from('trades').select('*')
                .eq('user_id', userId).eq('id', id).maybeSingle()
        );
        if (!existing) return null;

        // Read-modify-write, exactly like the desktop repository: metrics are
        // recomputed from the MERGED trade, not just the patch.
        const merged = { ...fromRow(existing), ...tradeData, updatedAt: new Date().toISOString() };
        const row: any = toRow(merged as Trade, userId);
        delete row.user_id;
        delete row.id;

        const saved = unwrap(
            await supabase.from('trades').update(row)
                .eq('user_id', userId).eq('id', id).select().single()
        );
        return fromRow(saved);
    },

    delete: async (id: string): Promise<void> => {
        const userId = await requireUserId();
        unwrap(await supabase.from('trades').delete().eq('user_id', userId).eq('id', id));
    },

    deleteMany: async (ids: string[]): Promise<void> => {
        if (!ids.length) return;
        const userId = await requireUserId();
        unwrap(await supabase.from('trades').delete().eq('user_id', userId).in('id', ids));
    },
};
