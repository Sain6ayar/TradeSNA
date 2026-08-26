import { supabase, requireUserId, unwrap } from '../lib/supabase';

/**
 * Key/value settings.
 *
 * Semantics are copied exactly from electron/db/settings.ts, quirks included:
 * values are stored as TEXT, and `get` attempts JSON.parse and falls back to
 * the raw string. Callers in the UI rely on both behaviours -- some write
 * JSON.stringify(obj), others write a bare string like a timezone offset.
 */
export const settingsApi = {
    get: async (key: string): Promise<any> => {
        const userId = await requireUserId();
        const row = unwrap(
            await supabase.from('settings').select('value')
                .eq('user_id', userId).eq('key', key).maybeSingle()
        ) as { value: string } | null;

        if (!row || row.value === null || row.value === undefined) return null;
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    },

    set: async (key: string, value: string): Promise<void> => {
        const userId = await requireUserId();
        unwrap(
            await supabase.from('settings')
                .upsert({ user_id: userId, key, value }, { onConflict: 'user_id,key' })
        );
    },

    getAll: async (): Promise<Record<string, any>> => {
        const userId = await requireUserId();
        const rows = unwrap(
            await supabase.from('settings').select('key, value').eq('user_id', userId)
        ) as Array<{ key: string; value: string }>;

        const settings: Record<string, any> = {};
        for (const row of rows) {
            try {
                settings[row.key] = JSON.parse(row.value);
            } catch {
                settings[row.key] = row.value;
            }
        }
        return settings;
    },
};
