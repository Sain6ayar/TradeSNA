import { supabase, requireUserId, unwrap } from '../lib/supabase';
import type { JournalEntry } from '../types';

function fromRow(row: any): JournalEntry {
    return {
        id: row.id,
        date: row.date,
        content: row.content,
        mood: row.mood,
        tags: Array.isArray(row.tags) ? row.tags : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    } as JournalEntry;
}

export const journalApi = {
    getAll: async (): Promise<JournalEntry[]> => {
        const userId = await requireUserId();
        const rows = unwrap(
            await supabase.from('journal_entries').select('*')
                .eq('user_id', userId).order('date', { ascending: false })
        ) as any[];
        return rows.map(fromRow);
    },

    getByDate: async (date: string): Promise<JournalEntry | undefined> => {
        const userId = await requireUserId();
        const row = unwrap(
            await supabase.from('journal_entries').select('*')
                .eq('user_id', userId).eq('date', date).maybeSingle()
        );
        return row ? fromRow(row) : undefined;
    },

    /**
     * One entry per calendar day: upsert on (user_id, date), which is the
     * unique constraint. The desktop version did a SELECT-then-branch; the
     * upsert collapses that into a single round trip with the same outcome.
     */
    save: async (entry: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<JournalEntry> => {
        const userId = await requireUserId();
        const now = new Date().toISOString();

        const existing = unwrap(
            await supabase.from('journal_entries').select('id, created_at')
                .eq('user_id', userId).eq('date', entry.date).maybeSingle()
        ) as { id: string; created_at: string } | null;

        const row = {
            user_id: userId,
            id: existing?.id ?? crypto.randomUUID(),
            date: entry.date,
            content: entry.content,
            mood: entry.mood,
            tags: entry.tags || [],
            created_at: existing?.created_at ?? now,
            updated_at: now,
        };

        const saved = unwrap(
            await supabase.from('journal_entries')
                .upsert(row, { onConflict: 'user_id,date' })
                .select().single()
        );
        return fromRow(saved);
    },
};
