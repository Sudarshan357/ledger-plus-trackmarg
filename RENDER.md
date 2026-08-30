# Hosting Ledger+ on Render

Until now the API lived only while the laptop was on, published through a Cloudflare Tunnel.
Close the lid and every phone lost its server. This moves it to a machine that stays up.

**The app does not change.** `https://ledger.trackmarg.in` is baked into the installed APK at
build time, so the *domain* is what moves, not the app. Every phone already carrying Ledger+
keeps working, with nothing to reinstall.

---

## What is already prepared

[render.yaml](render.yaml) describes the service — region, build, start command, health check.
Render reads it and prompts for the four secrets, which are deliberately not in the repo.

| | |
| --- | --- |
| Build | `npm ci && npx prisma generate && build:info && build:web && build:backend && db:migrate` |
| Start | `node backend/dist/index.js` |
| Health check | `/api/health` — no database work, so a slow query can never trigger a restart mid-write |
| Region | Singapore, matching the Supabase project |

Migrations run in the build, before the new instance goes live. They are tracked in
`ledger._migrations` and each runs once, so re-running on every deploy is a no-op.

Nothing is written to disk at runtime, so Render's ephemeral filesystem costs nothing here.

---

## 1. Create the service

1. Push this branch so `render.yaml` is on GitHub.
2. Render Dashboard → **New** → **Blueprint** → connect `ledger-plus-trackmarg`.
   The repo is private, so Render will ask for GitHub authorization once.
3. Render finds `render.yaml` and asks for four values. Take all four from your local `.env`:

   | Variable | Notes |
   | --- | --- |
   | `DATABASE_URL` | Supabase **pooled** connection, port 6543 |
   | `DIRECT_URL` | Supabase **direct** connection, port 5432 — migrations need this |
   | `SESSION_SECRET` | **Must be identical to the current one.** See the warning below |
   | `LEDGER_SUPPORT_PASSWORD` | Leave blank to disable the support console entirely |

4. Deploy. You get `https://ledger-plus.onrender.com`.

> **`SESSION_SECRET` must match exactly.** Session tokens are HMAC-signed with a key derived
> from it. A different value invalidates every token in existence, and both partners are
> silently signed out — they would need the group code, phone and PIN to get back in. Copy it,
> do not generate a new one.

### Check it before touching DNS

```bash
curl https://ledger-plus.onrender.com/api/health
curl https://ledger-plus.onrender.com/api/version
```

`/api/version` should report a `buildId` matching your latest commit, and a `release` block.
Open the URL in a browser and confirm the app loads and you can sign in. Do this *before* the
DNS switch, so a problem is never mixed up with a DNS problem.

---

## 2. Move the domain

`ledger.trackmarg.in` currently resolves to Cloudflare's proxy, pointing at the tunnel. It has
to point at Render instead.

1. **Render** → your service → **Settings** → **Custom Domains** → add `ledger.trackmarg.in`.
   Render shows the CNAME target it expects (`ledger-plus.onrender.com`).

2. **Cloudflare Zero Trust** → Networks → Tunnels → your tunnel → **Public Hostname** → delete
   the `ledger.trackmarg.in` entry. That removes the DNS record the tunnel created; leaving it
   would fight the new one.

3. **Cloudflare DNS** → add:

   | Type | Name | Target | Proxy |
   | --- | --- | --- | --- |
   | CNAME | `ledger` | `ledger-plus.onrender.com` | **DNS only** (grey cloud) |

   Grey cloud matters: Render issues its own TLS certificate over an HTTP challenge, and
   Cloudflare's proxy intercepts that challenge. Start grey. Once Render shows the domain as
   verified with a certificate issued, you may switch the proxy back on **only** if
   Cloudflare's SSL/TLS mode is **Full (strict)** — anything less and the two ends disagree
   about who terminates TLS, which is how the earlier 502 happened.

4. Wait for Render to report the certificate issued (usually a few minutes), then:

```bash
curl -sI https://ledger.trackmarg.in/api/health   # expect 200
curl -s  https://ledger.trackmarg.in/api/version  # expect the Render build
```

Open the installed Android app. It should work with no change at all — that is the whole point
of moving the domain rather than the app.

---

## 3. Retire the laptop

Once the domain serves from Render:

- Stop `npm run watch` — Render deploys on push to `main` by itself now.
- Stop the local server and `cloudflared`. If you installed cloudflared as a Windows service,
  remove it: `cloudflared.exe service uninstall` in an Administrator prompt.
- Keep the tunnel token rotated regardless (it was exposed in chat).

### How shipping an update changes

| Before | Now |
| --- | --- |
| `git push`, then `npm run deploy -- --restart` on the laptop | `git push` — Render builds and deploys |
| Laptop must be on | Nothing local involved |

`npm run release` is unchanged, and still the thing that ships an APK to phones: it builds,
signs and uploads the Android app, and publishes `version.json`. Web browsers pick up a plain
push; phones only update when there is a release behind it.

---

## The free plan, and what it costs you

`render.yaml` sets `plan: free`, so nothing here starts charging without you deciding to.

**A free service spins down after 15 minutes with no traffic**, and the next request waits
roughly a minute while it starts again. For an app two partners open a handful of times a day,
that means most opens are the slow one — and a partner standing in a workshop watching a
spinner will reasonably conclude the app is broken.

The offline cache softens this: the app opens instantly and shows the last known ledger while
the server wakes. But saving an entry still waits for the cold start.

Change one line in `render.yaml` to fix it:

```yaml
plan: starter    # currently: free
```

That is the single biggest difference to how the app feels. Judge it against what the app is
for — this is a business's books, used in front of customers.
