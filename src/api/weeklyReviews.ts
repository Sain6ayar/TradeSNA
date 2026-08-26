import { supabase, requireUserId, unwrap } from '../lib/supabase';

/**
 * Weekly AI reviews.
 *
 * Consumers read `.jsonData` (WeeklySummaryWidget, WeeklyReviewCarousel) while
 * writers send `.json_data`. The desktop repository exposed both, so we do too.
 */
function fromRow(row: any): any {
    const parsed = typeof row.json_data === 'string'
        ? safeParse(row.json_data)
        : row.json_data;
    return { ...row, json_data: parsed, jsonData: parsed };
}

function safeParse(s: string): any {
    try { return JSON.parse(s); } catch { return null; }
}

export const weeklyReviewsApi = {
    getAll: async (): Promise<any[]> => {
        try {
            const userId = await requireUserId();
            const rows = unwrap(
                await supabase.from('weekly_reviews').select('*')
                    .eq('user_id', userId).order('start_date', { ascending: false })
            ) as any[];
            return rows.map(fromRow);
        } catch (error) {
            console.error('Failed to get all weekly reviews:', error);
            return [];
        }
    },

    get: async (id: string): Promise<any | null> => {
        const userId = await requireUserId();
        const row = unwrap(
            await supabase.from('weekly_reviews').select('*')
                .eq('user_id', userId).eq('id', id).maybeSingle()
        );
        return row ? fromRow(row) : null;
    },

    save: async (review: any): Promise<boolean> => {
        const userId = await requireUserId();

        // Accept either a JSON string or a live object, like the desktop version.
        const jsonData = typeof review.json_data === 'string'
            ? safeParse(review.json_data)
            : (review.json_data ?? review.jsonData ?? null);

        unwrap(
            await supabase.from('weekly_reviews').upsert({
                user_id: userId,
                id: review.id,
                week_label: review.week_label ?? null,
                start_date: review.start_date ?? null,
                end_date: review.end_date ?? null,
                json_data: jsonData,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'user_id,id' })
        );
        return true;
    },

    delete: async (id: string): Promise<boolean> => {
        const userId = await requireUserId();
        unwrap(
            await supabase.from('weekly_reviews').delete()
                .eq('user_id', userId).eq('id', id)
        );
        return true;
    },
};
