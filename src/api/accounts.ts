import { supabase, requireUserId, unwrap } from '../lib/supabase';

export interface Account {
    id: string;
    name: string;
    isAggregated: boolean;
    color?: string;
    createdAt: string;
}

function fromRow(row: any): Account {
    return {
        id: row.id,
        name: row.name,
        isAggregated: Boolean(row.is_aggregated),
        color: row.color,
        createdAt: row.created_at,
    };
}

export const accountsApi = {
    getAll: async (): Promise<Account[]> => {
        const userId = await requireUserId();
        const rows = unwrap(
            await supabase.from('accounts').select('*')
                .eq('user_id', userId).order('created_at', { ascending: true })
        ) as any[];
        return rows.map(fromRow);
    },

    create: async (name: string, color?: string): Promise<Account> => {
        const userId = await requireUserId();
        const saved = unwrap(
            await supabase.from('accounts').insert({
                user_id: userId,
                id: crypto.randomUUID(),
                name,
                is_aggregated: true,
                color: color || null,
            }).select().single()
        );
        return fromRow(saved);
    },

    update: async (id: string, updates: Partial<Account>): Promise<void> => {
        const userId = await requireUserId();
        const patch: Record<string, any> = {};
        if (updates.name !== undefined) patch.name = updates.name;
        if (updates.isAggregated !== undefined) patch.is_aggregated = updates.isAggregated;
        if (updates.color !== undefined) patch.color = updates.color;
        if (!Object.keys(patch).length) return;

        unwrap(
            await supabase.from('accounts').update(patch)
                .eq('user_id', userId).eq('id', id)
        );
    },

    /**
     * Blocked while the account still holds trades -- same rule (and same
     * message) as the desktop app, so the UI's error handling is unchanged.
     */
    delete: async (id: string): Promise<void> => {
        const userId = await requireUserId();

        const { count, error } = await supabase
            .from('trades')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId).eq('account_id', id);
        if (error) throw new Error(error.message);

        if (count && count > 0) {
            throw new Error(
                `Cannot delete account with ${count} trades. Please delete trades first.`
            );
        }

        unwrap(await supabase.from('accounts').delete().eq('user_id', userId).eq('id', id));
    },
};
