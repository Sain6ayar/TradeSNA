import { supabase, requireUserId, unwrap } from '../lib/supabase';
import { settingsApi } from './settings';
import { DEFAULT_QUOTES } from '../data/defaultQuotes';

export interface Quote {
    id: number;
    text: string;
    author?: string;
    is_custom: number;
}

// Session-scoped state, mirroring the desktop service. In the browser a
// "session" is a page load, which is the natural analogue of an app launch.
let sessionQuoteFetched = false;
let lastSessionFrequency: string | null = null;

function fromRow(row: any): Quote {
    return {
        id: row.id,
        text: row.text,
        author: row.author ?? undefined,
        is_custom: row.is_custom ? 1 : 0,
    };
}

/** Parses the shipped affirmations CSV (one quote per line, header skipped). */
function parseQuotesCsv(content: string): string[] {
    return content
        .split(/\r?\n/)
        .slice(1)
        .map((line) => {
            let q = line.trim();
            if (!q) return '';
            if (q.startsWith('"') && q.endsWith('"')) q = q.slice(1, -1);
            return q.replace(/""/g, '"');
        })
        .filter((q) => q.length > 0);
}

export const quotesApi = {
    init: async (): Promise<number> => quotesApi.seedDefaults(false),

    getAll: async (): Promise<Quote[]> => {
        const userId = await requireUserId();
        const rows = unwrap(
            await supabase.from('quotes').select('*')
                .eq('user_id', userId).order('id', { ascending: false })
        ) as any[];
        return rows.map(fromRow);
    },

    add: async (text: string, author?: string): Promise<number> => {
        const userId = await requireUserId();
        const saved = unwrap(
            await supabase.from('quotes')
                .insert({ user_id: userId, text, author: author || null, is_custom: true })
                .select('id').single()
        ) as { id: number };
        return saved.id;
    },

    update: async (id: number, text: string): Promise<void> => {
        const userId = await requireUserId();
        unwrap(
            await supabase.from('quotes').update({ text })
                .eq('user_id', userId).eq('id', id)
        );
    },

    delete: async (id: number): Promise<void> => {
        const userId = await requireUserId();
        unwrap(await supabase.from('quotes').delete().eq('user_id', userId).eq('id', id));
    },

    clearAll: async (): Promise<void> => {
        const userId = await requireUserId();
        unwrap(await supabase.from('quotes').delete().eq('user_id', userId));
    },

    /** Bulk-import user CSV: "Quote","Author" or just "Quote" per line. */
    import: async (content: string): Promise<number> => {
        const userId = await requireUserId();
        const rows = content
            .split(/\r?\n/)
            .filter((l) => l.trim().length > 0)
            .map((line) => {
                const clean = line.replace(/^"|"$/g, '').replace(/""/g, '"');
                const parts = clean.split(',');
                const text = parts[0]?.trim();
                const author = parts.length > 1 ? parts[1]?.trim() : null;
                return text ? { user_id: userId, text, author, is_custom: true } : null;
            })
            .filter(Boolean) as any[];

        if (!rows.length) return 0;
        unwrap(await supabase.from('quotes').insert(rows));
        return rows.length;
    },

    seedDefaults: async (force: boolean = false): Promise<number> => {
        const userId = await requireUserId();

        if (!force) {
            const { count, error } = await supabase
                .from('quotes')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId);
            if (error) throw new Error(error.message);
            if (count && count > 0) return 0;
        } else {
            unwrap(await supabase.from('quotes').delete().eq('user_id', userId));
        }

        // Prefer the shipped CSV (365 curated affirmations); fall back to the
        // bundled constant if the static asset can't be fetched.
        let texts: string[] = [];
        try {
            const res = await fetch('/quotes.csv');
            if (res.ok) texts = parseQuotesCsv(await res.text());
        } catch (e) {
            console.warn('Could not fetch /quotes.csv, using bundled defaults:', e);
        }
        if (!texts.length) texts = [...DEFAULT_QUOTES];
        if (!texts.length) return 0;

        // Chunked so a 365-row insert stays well inside request limits.
        const CHUNK = 200;
        for (let i = 0; i < texts.length; i += CHUNK) {
            const batch = texts.slice(i, i + CHUNK)
                .map((text) => ({ user_id: userId, text, is_custom: false }));
            unwrap(await supabase.from('quotes').insert(batch));
        }
        return texts.length;
    },

    /**
     * Quote of the day. Honours the `quote_frequency` setting
     * (daily | hourly | always) exactly as the desktop service did.
     */
    getDaily: async (): Promise<string | null> => {
        const frequency = (await settingsApi.get('quote_frequency')) || 'daily';
        const lastId = parseInt((await settingsApi.get('last_quote_id')) || '0', 10);
        const lastTimeStr = await settingsApi.get('last_quote_time');
        const lastTime = lastTimeStr ? new Date(lastTimeStr) : new Date(0);
        const now = new Date();

        let shouldFetchNew = false;
        const freqVal = String(frequency);

        const frequencyChanged = lastSessionFrequency !== null && lastSessionFrequency !== freqVal;
        lastSessionFrequency = freqVal;

        if (freqVal === 'daily') {
            if (lastTime.getDate() !== now.getDate()
                || lastTime.getMonth() !== now.getMonth()
                || lastTime.getFullYear() !== now.getFullYear()) {
                shouldFetchNew = true;
            }
        } else if (freqVal === 'hourly') {
            if (now.getTime() - lastTime.getTime() > 1000 * 60 * 60) shouldFetchNew = true;
        } else if (freqVal === 'always') {
            if (!sessionQuoteFetched || frequencyChanged) shouldFetchNew = true;
        }

        if (!shouldFetchNew && lastId > 0) {
            const userId = await requireUserId();
            const cached = unwrap(
                await supabase.from('quotes').select('text')
                    .eq('user_id', userId).eq('id', lastId).maybeSingle()
            ) as { text: string } | null;
            if (cached) return cached.text;
        }

        const all = await quotesApi.getAll();
        if (!all.length) return null;

        const random = all[Math.floor(Math.random() * all.length)];
        sessionQuoteFetched = true;
        await settingsApi.set('last_quote_id', String(random.id));
        await settingsApi.set('last_quote_time', now.toISOString());

        return random.text;
    },
};
