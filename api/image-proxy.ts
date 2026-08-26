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
    'www.bookmap.com',
    's3.tradingview.com',
    'www.tradingview.com',
    'tradingview.com',
    'img.youtube.com',
    'i.ytimg.com',
];

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

export const config = { maxDuration: 30 };

export default async function handler(req: Request): Promise<Response> {
    const target = new URL(req.url).searchParams.get('url');
    if (!target) return text('Missing url parameter', 400);

    let parsed: URL;
    try {
        parsed = new URL(target);
    } catch {
        return text('Malformed url', 400);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return text('Only http(s) URLs are supported', 400);
    }

    const host = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
    if (!allowed) {
        return text(`Host not allowed: ${host}`, 403);
    }

    try {
        const upstream = await fetch(parsed.toString(), {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            redirect: 'follow',
        });

        if (!upstream.ok) {
            return text(`Upstream returned ${upstream.status}`, 502);
        }

        const buffer = await upstream.arrayBuffer();
        if (buffer.byteLength > MAX_BYTES) {
            return text('Image too large', 413);
        }

        const contentType = upstream.headers.get('content-type') || 'image/png';
        let mimeType = 'image/png';
        if (contentType.includes('jpeg') || contentType.includes('jpg')) mimeType = 'image/jpeg';
        else if (contentType.includes('gif')) mimeType = 'image/gif';
        else if (contentType.includes('webp')) mimeType = 'image/webp';
        else if (contentType.includes('png')) mimeType = 'image/png';
        else if (!contentType.startsWith('image/')) {
            return text('Upstream did not return an image', 415);
        }

        const base64 = Buffer.from(buffer).toString('base64');

        return new Response(
            JSON.stringify({ dataUrl: `data:${mimeType};base64,${base64}` }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'cache-control': 'public, max-age=86400',
                },
            }
        );
    } catch (err: any) {
        return text(`Fetch failed: ${err.message}`, 502);
    }
}

function text(body: string, status: number): Response {
    return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}
