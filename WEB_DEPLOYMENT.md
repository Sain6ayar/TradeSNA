# TradeSlate Web — deployment guide

**Live:** https://tradesna.vercel.app
Vercel project `mhr4/tradesna` · Supabase project `cddtnelubkwavycfpjkn`

Source lives at `Sain6ayar/TradeSNA` on the `web` branch — a fork of the
upstream desktop app at `Aikzar/TradeSlate`, which is read-only for this
account. Vercel builds from that repo, so **`web` must be set as the
Production Branch**: the fork's `main` still carries the Electron app and
would not produce a working site.

Manual deploys still work as a fallback: `npx vercel deploy --prod`.

This branch (`web`) is the browser build of TradeSlate: same React UI, with the
Electron/SQLite backend replaced by Supabase (Postgres + Auth + Storage) and two
Vercel serverless routes.

The desktop app on `main` is untouched.

---

## How the port works

Every native capability in the desktop build sat behind a single object,
`window.electronAPI`, injected by Electron's preload script. The web build
re-implements that same object against Supabase and installs it before React
mounts (`src/api/index.ts` → `installWebAPI()`).

That's why ~19,500 lines of UI code across `src/pages` and `src/components` are
unchanged — they still call `window.electronAPI.trades.getAll()` and neither
know nor care that it's now a PostgREST query.

| Desktop | Web |
| --- | --- |
| better-sqlite3 file in `userData` | Supabase Postgres, RLS per user |
| No user concept | Supabase Auth (email + password) |
| Images in `userData/trade-images` | Supabase Storage, private bucket, signed URLs |
| Whisper via `worker_threads` | Web Speech API (Chrome/Edge) |
| Native `dialog.showMessageBox` | `window.confirm` / `window.alert` |
| Save/Open file dialogs | Blob download / `<input type="file">` |
| Main process fetches cftc.gov | `POST /api/cot-fetch` (service role) |
| Main process proxies images | `GET /api/image-proxy` (host allowlist) |
| Gemini calls in main process | **Disabled in phase 1** — see below |

### Data isolation

Every user-owned table is keyed on `(user_id, id)` and carries a
`using (user_id = auth.uid())` RLS policy. The composite primary key is
deliberate: it lets a desktop backup import keep its **original** row ids —
including the legacy literal `'main-account'` — without two users ever
colliding. That's what makes the migration below lossless.

`cot_reports` is the one shared table: CFTC data is public market data, so all
users read one copy, and only the service-role key can write it.

---

## 1. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Open **SQL Editor** and run, in order:
   - `supabase/migrations/0001_init.sql` — tables, RLS, new-user trigger
   - `supabase/migrations/0002_storage.sql` — private image bucket + policies
3. Under **Authentication → Providers**, confirm Email is enabled.
   - Leave "Confirm email" **on** for a public deployment.
   - Turn it **off** if you want instant sign-in while testing.
4. Under **Authentication → URL Configuration**, set the Site URL to your
   Vercel domain once you have it.

Collect from **Project Settings → API**:

| Value | Used as |
| --- | --- |
| Project URL | `VITE_SUPABASE_URL` and `SUPABASE_URL` |
| `anon` public key | `VITE_SUPABASE_ANON_KEY` |
| `service_role` secret key | `SUPABASE_SERVICE_ROLE_KEY` |

> The `anon` key is *meant* to ship to browsers — RLS is what protects the data.
> The `service_role` key bypasses RLS entirely. Never give it a `VITE_` prefix,
> or Vite will bake it into the public bundle.

---

## 2. Deploy to Vercel

```bash
npm i -g vercel     # or use npx
vercel login
vercel link         # from the repo root, on the `web` branch

# Client-side (needed at BUILD time)
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# Server-side only (serverless functions)
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY

vercel --prod
```

Add each variable to **Production, Preview and Development** when prompted.
`VITE_*` values are read at build time, so changing one requires a redeploy.

Vercel auto-detects the Vite preset; `vercel.json` pins the build command,
output directory, and the SPA rewrite (the app is single-page with in-app
state routing, no router library).

---

## 3. Migrate your desktop data

Nothing is retyped — the web app reads the desktop app's own backup format.

1. In the **desktop** app: `Settings → Data → Export Data`, save the
   `tradeslate_backup_YYYY-MM-DD.json` file.
2. In the **web** app: sign up, then `Settings → Data → Import Data` and pick
   that file.

What transfers: trades (with all derived metrics), accounts, journal entries,
settings, import profiles and weekly reviews. Row ids are preserved, so the
`trade://ID` deep links inside saved weekly reviews keep working.

What does **not** transfer: trade screenshots. Those were files on your
machine, and the backup only ever stored `local://<filename>` references, not
the bytes. Their rows survive and the images can be re-uploaded per trade.

Export also works in the other direction — a backup taken from the web app
imports back into the desktop app.

---

## Local development

```bash
cp .env.example .env.local     # fill in the two VITE_ values
npm install
npm run dev                    # http://localhost:5173
```

`npm run typecheck` is available but currently reports 32 pre-existing errors
(unused variables and recharts v3 tooltip signatures) inherited from `main` —
the desktop build never typechecked `src/`, only `electron/`. `npm run build`
matches that behaviour and compiles via esbuild without typechecking.

The `/api` routes only run under `vercel dev`, not `vite dev`. Fetching COT
data and proxying external images will 404 in a plain `npm run dev` session;
everything else works.

---

## Phase 1 scope

**Voice dictation** now uses the browser's Web Speech API. It needs Chrome or
Edge; in other browsers the mic button reports that it's unsupported rather
than failing silently. The waveform visualiser still runs off the app's own
`AudioContext`, unchanged.

**AI features are disabled.** `src/api/misc.ts` keeps the five AI methods on
the API surface so the UI compiles and runs, but each throws a clear message.
To turn them on later:

1. Add `api/ai.ts` — a serverless route holding the Gemini key, forwarding the
   prompt logic that currently lives in `electron/ai.ts` (kept on `main`).
2. Replace the throwing bodies in `src/api/misc.ts` with `fetch` calls to it.
3. Flip `AI_ENABLED` to `true`.

Keeping the key server-side matters: a Gemini key in browser code is readable
by anyone who opens devtools.
