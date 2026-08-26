import { tradesApi } from './trades';
import { settingsApi } from './settings';
import { journalApi } from './journal';
import { accountsApi } from './accounts';
import { quotesApi } from './quotes';
import { importProfilesApi } from './importProfiles';
import { weeklyReviewsApi } from './weeklyReviews';
import { imagesApi } from './images';
import { cotApi } from './cot';
import { sttApi } from './stt';
import { backupApi } from './backup';
import { seedApi } from './seed';
import { dialogApi, windowApi, aiApi } from './misc';

/**
 * The compatibility layer.
 *
 * Everything native in the desktop build sat behind `window.electronAPI`, so
 * the whole port comes down to re-implementing that one object against
 * Supabase and a couple of serverless routes. Install it before React mounts
 * and the ~19k lines of UI code run unmodified.
 */
export const webAPI = {
    ping: () => console.log('pong'),

    trades: {
        getAll: tradesApi.getAll,
        create: tradesApi.create,
        update: tradesApi.update,
        delete: tradesApi.delete,
        deleteMany: tradesApi.deleteMany,
    },

    settings: {
        get: settingsApi.get,
        set: settingsApi.set,
        getAll: settingsApi.getAll,
        exportData: backupApi.exportData,
        importData: backupApi.importData,
    },

    journal: {
        getAll: journalApi.getAll,
        getByDate: journalApi.getByDate,
        save: journalApi.save,
    },

    ai: aiApi,

    debug: {
        getRawTrade: tradesApi.getRaw,
    },

    images: {
        openPicker: imagesApi.openPicker,
        saveLocal: imagesApi.saveLocal,
        resolvePath: imagesApi.resolvePath,
        deleteLocal: imagesApi.deleteLocal,
        saveAnnotated: imagesApi.saveAnnotated,
        downloadExternal: imagesApi.downloadExternal,
    },

    quotes: {
        getDaily: quotesApi.getDaily,
        getAll: quotesApi.getAll,
        add: quotesApi.add,
        update: quotesApi.update,
        delete: quotesApi.delete,
        clearAll: quotesApi.clearAll,
        import: quotesApi.import,
        init: quotesApi.init,
        seedDefaults: quotesApi.seedDefaults,
    },

    accounts: {
        getAll: accountsApi.getAll,
        create: accountsApi.create,
        update: accountsApi.update,
        delete: accountsApi.delete,
    },

    cot: {
        getLatest: cotApi.getLatest,
        getHistory: cotApi.getHistory,
        parseFile: cotApi.parseFile,
        getParserSource: cotApi.getParserSource,
        debugSearchId: cotApi.debugSearchId,
        loadFromAssets: cotApi.loadFromAssets,
        fetchLatest: cotApi.fetchLatest,
        getHistoryDates: cotApi.getHistoryDates,
        getReportByDate: cotApi.getReportByDate,
    },

    importProfiles: {
        getAll: importProfilesApi.getAll,
        getById: importProfilesApi.getById,
        create: importProfilesApi.create,
        update: importProfilesApi.update,
        delete: importProfilesApi.delete,
    },

    window: windowApi,
    dialog: dialogApi,

    weeklyReviews: {
        getAll: weeklyReviewsApi.getAll,
        get: weeklyReviewsApi.get,
        save: weeklyReviewsApi.save,
    },

    seed: {
        run: seedApi.run,
    },

    stt: sttApi,
};

/** Must run before any component mounts. */
export function installWebAPI() {
    (window as any).electronAPI = webAPI;
}
