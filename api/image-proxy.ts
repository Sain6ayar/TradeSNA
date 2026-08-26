import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Fetches a third-party chart screenshot and returns it as a data URL.
 *
 * TradingView and Bookmap don't send CORS headers, so the browser can't read
 * those bytes directly -- the desktop build sidestepped this by fetching from
 * the Electron main process. This is the web equivalent.
 *
 * Deliberately narrow: only http(s), only the image hosts the app actually
 * links to, and a hard size cap. An open proxy would let anyone use this
 * deployment to launder requests or probe private network addresses.
 */
const ALLOWED_HOSTS = [
    'bookmap.com',
    's3.tradingview.com',
    'tradingview.com',
    'img.youtube.com',
    'i.ytimg.com',
];

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const raw = req.query.url;
    const target = Array.isArray(raw) ? raw[0] : raw;

    if (!target) return res.status(400).send('Missing url parameter');

    let parsed: URL;
    try {
        parsed = new URL(target);
    } catch {
        return res.status(400).send('Malformed url');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).send('Only http(s) URLs are supported');
    }

    // Exact host, or a subdomain of an allowed host. Substring matching would
    // let `bookmap.com.evil.tld` through.
    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    if (!allowed) return res.status(403).send(`Host not allowed: ${host}`);

    try {
        const upstream = await fetch(parsed.toString(), {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
        });

        if (!upstream.ok) {
            return res.status(502).send(`Upstream returned ${upstream.status}`);
        }

        const contentType = upstream.headers.get('content-type') || 'image/png';
        let mimeType = 'image/png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) mimeType = 'image/jpeg';
        else if (contentType.includes('gif')) mimeType = 'image/gif';
        else if (contentType.includes('webp')) mimeType = 'image/webp';
        else if (contentType.includes('png')) mimeType = 'image/png';
        else if (!contentType.startsWith('image/')) {
            return res.status(415).send('Upstream did not return an image');
        }

        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (buffer.byteLength > MAX_BYTES) {
            return res.status(413).send('Image too large');
        }

        res.setHeader('cache-control', 'public, max-age=86400');
        return res.status(200).json({
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        });
    } catch (err: any) {
        return res.status(502).send(`Fetch failed: ${err.message}`);
    }
}
