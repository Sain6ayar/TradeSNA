import { supabase, requireUserId } from '../lib/supabase';

/**
 * Trade screenshots.
 *
 * Desktop stored these as files under userData/trade-images and referenced
 * them as `local://<filename>`. We keep that exact token in the database --
 * so existing rows and desktop backups stay valid -- but the bytes now live in
 * a private Supabase Storage bucket under `<userId>/<filename>`, and
 * resolvePath hands back a short-lived signed URL instead of a file:// path.
 */
const BUCKET = 'trade-images';
const SIGNED_URL_TTL = 60 * 60; // 1 hour

/**
 * openPicker() has to return something saveLocal() can later resolve. The
 * browser gives us File objects, not paths, so we hand out opaque tokens and
 * keep the Files here until they're uploaded.
 */
const pending = new Map<string, File>();

function extensionOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i) : '';
}

function storageKey(userId: string, localPath: string): string {
    return `${userId}/${localPath.replace('local://', '')}`;
}

export const imagesApi = {
    /** Opens a file dialog and returns opaque tokens for the chosen files. */
    openPicker: async (): Promise<string[] | null> => {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
            input.multiple = true;
            input.style.display = 'none';
            document.body.appendChild(input);

            let settled = false;
            const finish = (value: string[] | null) => {
                if (settled) return;
                settled = true;
                input.remove();
                resolve(value);
            };

            input.onchange = () => {
                const files = Array.from(input.files || []);
                if (!files.length) return finish(null);
                const tokens = files.map((file) => {
                    const token = `pick://${crypto.randomUUID()}`;
                    pending.set(token, file);
                    return token;
                });
                finish(tokens);
            };

            // 'cancel' fires in modern browsers; without it a dismissed dialog
            // would leave the promise hanging forever.
            input.oncancel = () => finish(null);

            input.click();
        });
    },

    /** Uploads a token from openPicker() and returns its `local://` handle. */
    saveLocal: async (sourceToken: string): Promise<string> => {
        const userId = await requireUserId();
        const file = pending.get(sourceToken);
        if (!file) throw new Error('Image selection expired. Please pick the file again.');

        const fileName = `${crypto.randomUUID()}${extensionOf(file.name)}`;
        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(`${userId}/${fileName}`, file, {
                contentType: file.type || 'image/png',
                upsert: false,
            });
        if (error) throw new Error(error.message);

        pending.delete(sourceToken);
        return `local://${fileName}`;
    },

    /** `local://x` -> signed URL. Anything else passes through untouched. */
    resolvePath: async (localPath: string): Promise<string> => {
        if (!localPath || !localPath.startsWith('local://')) return localPath;

        const userId = await requireUserId();
        const { data, error } = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(storageKey(userId, localPath), SIGNED_URL_TTL);

        if (error || !data) {
            console.error('Failed to resolve image:', localPath, error);
            return '';
        }
        return data.signedUrl;
    },

    deleteLocal: async (localPath: string): Promise<boolean> => {
        if (!localPath || !localPath.startsWith('local://')) return false;
        try {
            const userId = await requireUserId();
            const { error } = await supabase.storage
                .from(BUCKET)
                .remove([storageKey(userId, localPath)]);
            if (error) throw error;
            return true;
        } catch (err) {
            console.error('Failed to delete image:', err);
            return false;
        }
    },

    /** Stores a canvas data URL (the annotation editor's output). */
    saveAnnotated: async (dataUrl: string): Promise<string> => {
        const userId = await requireUserId();
        const res = await fetch(dataUrl);
        const blob = await res.blob();

        const fileName = `${crypto.randomUUID()}.png`;
        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(`${userId}/${fileName}`, blob, { contentType: 'image/png', upsert: false });
        if (error) throw new Error(error.message);

        return `local://${fileName}`;
    },

    /**
     * Fetches a third-party image (TradingView, Bookmap) as a data URL.
     * Runs through a serverless proxy because those hosts don't send CORS
     * headers -- the desktop build did the same thing from the main process.
     */
    downloadExternal: async (url: string): Promise<string> => {
        const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`Failed to fetch image: ${res.status} ${detail}`);
        }
        const { dataUrl } = await res.json();
        return dataUrl;
    },
};
