import { supabase, requireUserId, unwrap } from '../lib/supabase';
import { backupApi } from './backup';

/**
 * Loads the bundled demo dataset (50 trades, a weekly review, 365 quotes)
 * into the signed-in account. Port of electron/SeedService.ts, which read the
 * same seed_data.json off disk.
 */
export const seedApi = {
    run: async (): Promise<boolean> => {
        const userId = await requireUserId();

        const res = await fetch('/seed_data.json');
        if (!res.ok) throw new Error('Could not load bundled demo data.');
        const seed = await res.json();

        const trades = (seed.trades || []).map((t: any) => ({
            ...t,
            // Seed rows predate multi-account support; park them on the
            // default account the signup trigger created.
            account_id: t.account_id || 'main-account',
        }));

        await backupApi.restore({
            trades,
            weeklyReviews: seed.weekly_reviews || [],
        });

        // Quotes aren't part of the backup format, so insert them directly.
        if (Array.isArray(seed.quotes) && seed.quotes.length) {
            const { count } = await supabase
                .from('quotes')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (!count) {
                const rows = seed.quotes.map((q: any) => ({
                    user_id: userId,
                    text: typeof q === 'string' ? q : q.text,
                    author: typeof q === 'string' ? null : (q.author ?? null),
                    is_custom: typeof q === 'string' ? false : Boolean(q.is_custom),
                })).filter((r: any) => r.text);

                for (let i = 0; i < rows.length; i += 200) {
                    unwrap(await supabase.from('quotes').insert(rows.slice(i, i + 200)) as any);
                }
            }
        }

        return true;
    },
};
