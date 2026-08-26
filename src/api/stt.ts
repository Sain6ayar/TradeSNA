/**
 * Voice dictation.
 *
 * The desktop build ran Whisper in a Node worker thread and was fed raw
 * Float32 audio chunks over IPC. That can't work in a browser tab, so this
 * uses the built-in Web Speech API instead: no model download, no cost, and
 * live interim results.
 *
 * The event-emitter shape (onReady/onResult/onError/... returning an
 * unsubscribe function) is preserved exactly, so TradeDetail.tsx is unchanged.
 * `sendAudio` becomes a no-op -- the component's own AudioContext pipeline
 * keeps running, which is what drives the waveform visualiser.
 */
type Listener<T> = (data: T) => void;

const listeners = {
    progress: new Set<Listener<any>>(),
    ready: new Set<Listener<any>>(),
    result: new Set<Listener<string>>(),
    error: new Set<Listener<string>>(),
    unloaded: new Set<Listener<void>>(),
};

function emit<K extends keyof typeof listeners>(event: K, data?: any) {
    listeners[event].forEach((fn) => {
        try { (fn as any)(data); } catch (e) { console.error(e); }
    });
}

function subscribe<K extends keyof typeof listeners>(event: K, cb: any): () => void {
    listeners[event].add(cb);
    return () => { listeners[event].delete(cb); };
}

function getSpeechRecognition(): any {
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
    return getSpeechRecognition() !== null;
}

let recognition: any = null;
let stopRequested = false;

export const sttApi = {
    start: async (): Promise<void> => {
        const SR = getSpeechRecognition();
        if (!SR) {
            emit('error',
                'Voice dictation is not supported in this browser. Chrome or Edge is required.');
            return;
        }
        if (recognition) return;

        stopRequested = false;
        recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = false; // only commit finalised phrases
        recognition.lang = navigator.language || 'en-US';

        recognition.onstart = () => emit('ready', { device: 'browser' });

        recognition.onresult = (event: any) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (!result.isFinal) continue;
                const text = (result[0]?.transcript || '').trim();
                if (text) emit('result', text);
            }
        };

        recognition.onerror = (event: any) => {
            const code = event?.error || 'unknown';
            // 'no-speech' and 'aborted' are routine during a long dictation --
            // surfacing them as errors would spam the user with alerts.
            if (code === 'no-speech' || code === 'aborted') return;
            emit('error',
                code === 'not-allowed'
                    ? 'Microphone permission denied.'
                    : `Speech recognition error: ${code}`);
        };

        recognition.onend = () => {
            // Chrome ends the session on its own after a pause; restart unless
            // the user actually asked us to stop.
            if (!stopRequested && recognition) {
                try { recognition.start(); return; } catch { /* fall through */ }
            }
            recognition = null;
            emit('unloaded');
        };

        try {
            recognition.start();
        } catch (err: any) {
            recognition = null;
            emit('error', err?.message || 'Failed to start speech recognition.');
        }
    },

    stop: async (): Promise<void> => {
        stopRequested = true;
        if (!recognition) return;
        try { recognition.stop(); } catch { /* already stopped */ }
        recognition = null;
    },

    /** No-op: Web Speech captures its own audio. Kept for API compatibility. */
    sendAudio: (_chunk: Float32Array): void => { /* intentionally empty */ },

    unload: async (): Promise<void> => {
        await sttApi.stop();
        emit('unloaded');
    },

    /** Nothing to download, so the "model" is always cached. */
    checkCache: async (_modelId: string): Promise<boolean> => true,

    onProgress: (cb: Listener<any>) => subscribe('progress', cb),
    onReady: (cb: Listener<any>) => subscribe('ready', cb),
    onResult: (cb: Listener<string>) => subscribe('result', cb),
    onError: (cb: Listener<string>) => subscribe('error', cb),
    onUnloaded: (cb: Listener<void>) => subscribe('unloaded', cb),
};
