# Deploying to Vercel

Everything in the repo is ready. These steps need your accounts, so they're yours to run.
Order matters: `VITE_GOOGLE_CLIENT_ID` is baked in at **build** time, so it must exist before
the first build, and changing it later needs a redeploy rather than a restart.

## 1. Production database

In the Neon project, create a **production** branch separate from `dev`, and copy its
**pooled** connection string. Keep dev and production separate — a deploy pointed at `dev`
will happily write to the data you've been testing with.

## 2. Vercel project

Import the repo at <https://vercel.com/new> with the **Vite** preset, and set these
Environment Variables for **Production**:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the **production** Neon branch string (not `dev`) |
| `GOOGLE_CLIENT_ID` | your OAuth client id |
| `VITE_GOOGLE_CLIENT_ID` | the same value again |
| `ALLOWED_EMAILS` | your email address |
| `SESSION_SECRET` | a **new** value — see below, not the local one |

```bash
openssl rand -base64 32
```

A separate secret per environment means a leaked local `.env` cannot mint production sessions.

## 3. OAuth origins

Add `https://<project>.vercel.app` to the OAuth client's **Authorised JavaScript origins**,
alongside the existing `http://localhost:5173`. Without this the Google button silently
fails to render in production.

## 4. Migrate and seed production

Create `.env.production` locally holding only the production `DATABASE_URL` (it's gitignored):

```bash
pnpm db:migrate:prod
```

Check the host it prints is the production branch, then:

```bash
pnpm db:seed:prod
```

Expected `Seeded 4 habits.` — it's a no-op if they already exist, so it can't duplicate.

## 5. Verify — the check this phase exists for

`Secure` on the session cookie cannot be tested locally, because Vercel terminates TLS at its
edge and the function legitimately sees a plain `http:` request. That's the whole reason the
cookie now reads `x-forwarded-proto` instead of the request URL.

```bash
curl -s -i -X POST https://<project>.vercel.app/api/auth/logout -H 'content-type: application/json' | grep -i set-cookie
```

Expected: the header names **`__Host-habit_session`** and carries **`Secure`**.
If it shows the plain `habit_session` name, or lacks `Secure`, the fix has not worked —
the session cookie could travel over plain http. Stop and tell me rather than continuing.

```bash
curl -s -o /dev/null -w 'habits: %{http_code}\n' https://<project>.vercel.app/api/habits
```

Expected **401** — an unauthenticated request must not reach data from the public internet.
`/api/health` should still return 200.

## 6. Verify in the browser

Signed out → redirected to `/login`. Sign in → dashboard with the four habits. Reload → still
signed in. Deep-link to `/habits` directly → it loads rather than 404ing (proves the SPA
rewrite). Log a day, reload → it persists. Sign out → back at `/login`.

## 7. Verify the allowlist rejects, in production

Temporarily set `ALLOWED_EMAILS` on Vercel to an address that is **not** your account,
redeploy, clear cookies, and try to sign in. Expected **403** with no session. Then restore
the real value, redeploy, and confirm sign-in works again.

You proved this locally already; it's worth proving again in production, because it's the one
control standing between a public URL and your data.
