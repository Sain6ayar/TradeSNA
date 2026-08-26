/**
 * Small shims for surfaces that were native in Electron.
 */

/** Native message boxes become the browser's own modal dialogs. */
export const dialogApi = {
    confirm: async (message: string, _title?: string): Promise<boolean> =>
        window.confirm(message),
    alert: async (message: string, _title?: string): Promise<void> => {
        window.alert(message);
    },
};

/** Window focus management was an Electron-only concern. */
export const windowApi = {
    focus: async (): Promise<void> => { /* no-op on the web */ },
};

/**
 * AI is out of scope for phase 1. The methods stay on the API surface so the
 * existing UI still type-checks and compiles; each one fails with a message
 * that explains the situation rather than a stack trace.
 *
 * To enable later: add a /api/ai serverless function that holds the Gemini
 * key and forwards these calls, then swap these bodies for fetch() calls.
 */
const PHASE_1_MESSAGE =
    'AI features are not enabled in this deployment yet.';

function notEnabled(): never {
    throw new Error(PHASE_1_MESSAGE);
}

export const aiApi = {
    analyzeTrade: async (_trade: any): Promise<any> => notEnabled(),
    coachJournal: async (_content: string, _mood: string): Promise<any> => notEnabled(),
    queryTrades: async (_query: string, _trades: any[]): Promise<any> => notEnabled(),
    weeklyReview: async (_trades: any[], _weekId?: string): Promise<any> => notEnabled(),
    rewriteJournal: async (
        _text: string,
        _context: { market?: string; direction?: string }
    ): Promise<string> => notEnabled(),
};

/** Whether AI calls will succeed. The UI can use this to hide AI affordances. */
export const AI_ENABLED = false;
