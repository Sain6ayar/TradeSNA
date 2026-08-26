import { supabase, requireUserId, unwrap } from '../lib/supabase';

export interface ImportProfileRow {
    id: string;
    name: string;
    type: string;
    column_mappings: string; // JSON *string* -- see note below
    date_format: string | null;
    delimiter: string;
    created_at: string;
    updated_at: string;
}

/**
 * The column is jsonb in Postgres, but ImportManager.tsx does
 * `JSON.parse(p.column_mappings || '{}')` on the way in. Re-stringifying here
 * keeps that consumer working untouched -- the alternative would be editing
 * the component to branch on type, which buys nothing.
 */
function fromRow(row: any): ImportProfileRow {
    return {
        id: row.id,
        name: row.name,
        type: row.type,
        column_mappings: typeof row.column_mappings === 'string'
            ? row.column_mappings
            : JSON.stringify(row.column_mappings ?? {}),
        date_format: row.date_format,
        delimiter: row.delimiter,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

export const importProfilesApi = {
    getAll: async (): Promise<ImportProfileRow[]> => {
        const userId = await requireUserId();
        const rows = unwrap(
            await supabase.from('import_profiles').select('*')
                .eq('user_id', userId).order('name')
        ) as any[];
        return rows.map(fromRow);
    },

    getById: async (id: string): Promise<ImportProfileRow | null> => {
        const userId = await requireUserId();
        const row = unwrap(
            await supabase.from('import_profiles').select('*')
                .eq('user_id', userId).eq('id', id).maybeSingle()
        );
        return row ? fromRow(row) : null;
    },

    create: async (
        name: string,
        columnMappings: object,
        dateFormat?: string,
        delimiter: string = ','
    ): Promise<string> => {
        const userId = await requireUserId();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        unwrap(
            await supabase.from('import_profiles').insert({
                user_id: userId,
                id,
                name,
                type: 'custom',
                column_mappings: columnMappings ?? {},
                date_format: dateFormat || null,
                delimiter,
                created_at: now,
                updated_at: now,
            })
        );
        return id;
    },

    update: async (
        id: string,
        data: { name?: string; columnMappings?: object; dateFormat?: string; delimiter?: string }
    ): Promise<void> => {
        const userId = await requireUserId();
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };

        if (data.name !== undefined) patch.name = data.name;
        if (data.columnMappings !== undefined) patch.column_mappings = data.columnMappings;
        if (data.dateFormat !== undefined) patch.date_format = data.dateFormat;
        if (data.delimiter !== undefined) patch.delimiter = data.delimiter;

        unwrap(
            await supabase.from('import_profiles').update(patch)
                .eq('user_id', userId).eq('id', id)
        );
    },

    delete: async (id: string): Promise<void> => {
        const userId = await requireUserId();
        unwrap(
            await supabase.from('import_profiles').delete()
                .eq('user_id', userId).eq('id', id)
        );
    },
};
