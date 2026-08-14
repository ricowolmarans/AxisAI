# Axis AI — Netlify + Supabase backend

An all-in-one AI workspace pulling Canvas, Gmail, Microsoft/Outlook, and
Slack into one place, with AI (Groq / OpenRouter) chat grounded in your
actual data. Every user logs in, connects their own accounts, and their
credentials never leave Supabase except server-side, inside Netlify
Functions, after their session is verified.

## Architecture

- **Netlify** hosts the static frontend and all backend logic (Netlify
  Functions) — no separate server to run.
- **Supabase** is the backend platform: Auth (email+password), Postgres
  (all app data), RLS enforcing per-user isolation on every table that can
  be read directly by the browser.
- **Groq / OpenRouter** are the AI providers, called only from
  `chat.js`, never from the browser.
- Secrets (API keys, OAuth client secrets, service_role key) live only as
  Netlify environment variables. User-specific OAuth tokens live only in
  `integration_tokens`, which has **no RLS policy at all** — meaning even
  the browser, using the logged-in user's own session, cannot read or write
  that table. Only Netlify Functions (using the service_role key) can.

## 1. Supabase setup

1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`. This creates:
   `profiles`, `connected_accounts`, `integration_tokens`,
   `integration_sync_logs`, `chats`, `messages`, `documents`, `ai_memory` —
   all RLS-locked to each user's own rows (details on `integration_tokens`
   above).
3. Authentication → Providers → Email → turn off "Confirm email" to avoid
   the free-tier email-sending limit entirely (accounts activate instantly).
4. Project Settings → API → copy Project URL, anon key, and service_role
   key. All three become Netlify environment variables (step 3 below) — none
   of them need pasting into any file by hand. A small build step
   (`build-inject.js`, wired up in `netlify.toml`) injects `SUPABASE_URL`
   and `SUPABASE_ANON_KEY` into the page automatically on every deploy.
5. (Optional, for `documents`) Storage → create a bucket, e.g. `user-files`,
   private by default — the `documents` table just stores metadata pointing
   into it; wiring an upload UI to it is a suggested next step, not done yet.

## 2. Deploy

```bash
npm install -g netlify-cli
cd axis-ai-netlify
npm install
netlify init
netlify deploy --prod
```
Or connect the GitHub repo directly in the Netlify dashboard — either
works, `netlify.toml` handles build settings automatically.

## 3. Netlify environment variables

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all functions + build step | same project URL, also injected into the frontend at build time |
| `SUPABASE_ANON_KEY` | build step | injected into `public/index.html` at build time — never hand-pasted |
| `SUPABASE_SERVICE_ROLE_KEY` | all functions | secret — bypasses RLS, server-side only |
| `OPENROUTER_API_KEY` | chat.js | app-level, from openrouter.ai |
| `GROQ_API_KEY` | chat.js | app-level, from console.groq.com |
| `GOOGLE_CLIENT_ID` | gmail.js, chat.js, google-oauth-exchange.js | same value pasted into `public/index.html` |
| `GOOGLE_CLIENT_SECRET` | gmail.js, chat.js, google-oauth-exchange.js | from the same Google Cloud OAuth Client |
| `MS_CLIENT_ID` | outlook.js, chat.js, ms-oauth-exchange.js | same value pasted into `public/index.html` |
| `MS_CLIENT_SECRET` | outlook.js, chat.js, ms-oauth-exchange.js | from the Azure App Registration |
| `MS_REDIRECT_URI` | ms-oauth-exchange.js | `https://your-site.netlify.app/ms-callback.html` — must exactly match what's registered in Azure |
| `GITHUB_CLIENT_ID` | github.js, chat.js, github-oauth-exchange.js | same value pasted into `public/index.html` |
| `GITHUB_CLIENT_SECRET` | github-oauth-exchange.js | from the GitHub OAuth App |
| `GITHUB_REDIRECT_URI` | github-oauth-exchange.js | `https://your-site.netlify.app/github-callback.html` — must exactly match the OAuth App's callback URL |
| `NOTION_CLIENT_ID` | notion.js, chat.js, notion-oauth-exchange.js | same value pasted into `public/index.html` |
| `NOTION_CLIENT_SECRET` | notion-oauth-exchange.js | from the Notion integration's OAuth tab |
| `NOTION_REDIRECT_URI` | notion-oauth-exchange.js | `https://your-site.netlify.app/notion-callback.html` — must exactly match what's registered in Notion |
| `CANVA_CLIENT_ID` | canva.js, canva-oauth-exchange.js | same value pasted into `public/index.html` |
| `CANVA_CLIENT_SECRET` | canva.js, canva-oauth-exchange.js | from the Canva integration's Configuration tab |
| `CANVA_REDIRECT_URI` | canva-oauth-exchange.js | `https://your-site.netlify.app/canva-callback.html` — must exactly match what's registered in Canva |

Canvas domain/token and Slack token are entered per-user in the
Integrations screen and saved via `save-credentials.js` — nothing to set
as an env var for those. GitHub, Notion, and Canva are all click-to-authorize
OAuth like Gmail/Outlook — no tokens to paste in, ever.

## 4. Gmail — real OAuth, no redirect URL needed

Uses Google's popup flow (`ux_mode: "popup"`, `redirect_uri: "postmessage"`),
which returns the auth code via `postMessage` instead of a real redirect:

1. Google Cloud Console → OAuth Client ID (Application type: **Web application**).
2. **Authorized JavaScript origins**: your site's URL + `http://localhost:8888`
   for local dev. **Leave Authorized redirect URIs empty.**
3. Scope needed: `https://www.googleapis.com/auth/gmail.readonly`
4. Paste the Client ID into `GOOGLE_CLIENT_ID` in `public/index.html`
   (public value, safe to expose) and set both `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` as Netlify env vars.

## 5. Microsoft/Outlook — real OAuth, one small redirect page

Microsoft's identity platform doesn't support Google's zero-redirect
popup trick — it needs an actual redirect URI. `public/ms-callback.html`
fills that role: a tiny static page on your own already-deployed site that
just relays the auth code back via `postMessage` and closes itself. One
URL to register, nothing extra to host.

1. Azure Portal → App registrations → New registration.
2. Platform: **Single-page application (SPA)** or **Web**, redirect URI:
   `https://your-site.netlify.app/ms-callback.html`
3. API permissions: `Mail.Read`, `User.Read`, `offline_access`.
4. Certificates & secrets → new client secret.
5. Paste the Application (client) ID into `MS_CLIENT_ID` in
   `public/index.html`. Set `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, and
   `MS_REDIRECT_URI` (the exact URL from step 2) as Netlify env vars.

## 6. On Slack and Discord

Discord's bot API cannot see personal DMs — bots only see channels/DMs
they're explicitly added to. The only workaround is a "self-bot" user
token, an explicit Discord ToS violation, so it isn't implemented.

Slack DMs are readable legitimately with a Slack **user token**
(`xoxp-...`, not a bot token) with `im:history` scope. Enter it in the
Slack card in Integrations.

## 7. Local dev

```bash
netlify dev
```
Create a local `.env` file (already gitignored) with at least
`SUPABASE_URL` and `SUPABASE_ANON_KEY` — `netlify dev` runs the build step
automatically on startup, same as production, so local testing gets a
properly-configured `public/index.html` too. Without it, the app just shows
its "not configured" banner locally, same as it would in prod.

## Migrating from the old single-table schema

If you already have data in the old `integrations` table, see the
commented-out migration block at the bottom of `supabase/schema.sql` — it
copies existing rows into the new normalized tables before you drop the
old one.

---

## Audit results (this update)

### Files modified
- `netlify/functions/lib/supabaseAdmin.js` — rewritten for the normalized
  tables; added `verifyUser`, `getServiceToken`, `saveServiceToken`,
  `upsertConnectedAccount`, `logSync`.
- `netlify/functions/canvas.js`, `slack.js`, `gmail.js` — read from
  `integration_tokens` via the new helpers, log every call to
  `integration_sync_logs`.
- `netlify/functions/google-oauth-exchange.js` — **security fix**: now
  writes the refresh token directly to the DB server-side and never
  returns it in the HTTP response (previously the browser received the
  refresh token and wrote it itself).
- `netlify/functions/chat.js` — context-gathering rewritten for the
  normalized tables; added Outlook as a fourth context source.
- `public/index.html` — Integrations UI rewritten to read
  `connected_accounts` (safe metadata) instead of raw tokens, save
  Canvas/Slack via `save-credentials.js` instead of direct table writes,
  added the Microsoft card, added last-synced display, added profile
  `full_name` lookup for the greeting.
- `README.md`, `supabase/schema.sql` — this file and the full restructure.

### Files created
- `netlify/functions/lib/microsoft.js` — Microsoft token refresh helper.
- `netlify/functions/ms-oauth-exchange.js`, `netlify/functions/outlook.js`
  — Microsoft OAuth exchange and Graph API mail reading.
- `netlify/functions/save-credentials.js` — the only path Canvas/Slack
  secrets take into the database now, always through a verified session.
- `public/ms-callback.html` — static OAuth popup callback page.

### Security improvements
1. **Closed a real exposure**: `integration_tokens` (refresh tokens, access
   tokens) now has zero RLS policies, so it's unreachable by the anon key
   entirely — only service_role (server-side) can touch it. Previously
   secrets sat in a table the browser's own session could `SELECT` back.
2. Split "safe to display" (`connected_accounts`: status, label, last sync)
   from "secret" (`integration_tokens`) into separate tables — a genuine
   defense-in-depth improvement, not just cosmetic.
3. Google OAuth exchange no longer round-trips the refresh token through
   the browser at all.
4. Every integration call now logs to `integration_sync_logs`
   (success/error + message), giving an audit trail per user per service.

### Database improvements
- Normalized single wide `integrations` table into
  `connected_accounts` + `integration_tokens` + `integration_sync_logs` —
  adding a future integration means one new `service` value, not a schema
  migration.
- Added `profiles` with an auto-create trigger on signup (`handle_new_user`)
  — the app no longer has to special-case "no profile row yet."
- Added `documents` and `ai_memory` tables, scaffolded and RLS-locked, not
  yet wired into any UI — see below.

### Productivity improvements
- Outlook added as a real context source alongside Canvas/Gmail/Slack, so
  "what do I need to do today" can now actually reflect Microsoft mail too.
- Dashboard integration cards now show last-synced time, not just
  connected/not-connected.

### Remaining issues (honest list, not fixed in this pass)
- **No scheduled/background sync** — `last_sync_at` only updates when a
  user manually hits Test or sends a chat message that happens to touch
  that source. True periodic sync needs Netlify Scheduled Functions (cron)
  writing into `integration_sync_logs` independent of user activity.
- **No rate limiting** on the free-text model field in chat — a user could
  point it at an expensive model repeatedly with no cost guardrail.
- **CORS is wide open** (`Access-Control-Allow-Origin: *`) on all
  functions. Low risk since every call still requires a valid Supabase JWT,
  but tightening to your actual domain is cheap and strictly better.
- **`ai_memory` and `documents` are scaffolded, not implemented** — no code
  writes to `ai_memory` yet (no fact-extraction pipeline), and no upload UI
  exists for `documents`/Storage.
- **`integration_tokens.access_token`/`refresh_token` are stored as plain
  text columns** in Postgres. Supabase's disk-level encryption covers this
  reasonably, but genuine field-level encryption (e.g. `pgsodium`/Vault)
  would be a step up if this ever handles more sensitive scopes than
  read-only mail/DMs.

### Recommended future enhancements
- Netlify Scheduled Functions for real background sync + push-style
  "what's new" notifications instead of pull-on-demand.
- Wire `ai_memory`: after each chat, a lightweight extraction call that
  writes durable facts ("prefers evening study sessions") for later recall.
- Document upload → Supabase Storage → `documents` table → let the AI
  reference uploaded files as chat context.
- Per-user model/cost limits, since the model field is free text.
- Field-level encryption for `integration_tokens` if scope creep ever adds
  write-capable integrations.
