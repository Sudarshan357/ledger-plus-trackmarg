# Ledger+

Mobile-first partnership accounting for a two-partner business, built on the existing
**Trackmarg Group Code system**.

Two partners → one Trackmarg group code → one shared ledger. Each partner records only their
own entries, both see everything, a deleted record can only be destroyed by the *other*
partner, and settling a session archives it in full before the next one starts from ₹0.

---

## Its own database

Ledger+ runs on its own Supabase project (`ap-southeast-1`) and owns every table in it. It
shares nothing with the Trackmarg transport app: separate database, separate `SESSION_SECRET`,
separate group-code registry.

| Concern | Where it lives |
| --- | --- |
| Accounts, group codes, auth sessions | `public.Group`, `public.User`, `public.Session` — created and owned by this app (`0000_public_baseline.sql`) |
| Ledger data | The `ledger` Postgres schema |

It did not start this way. Ledger+ was originally built against the transport app's database,
reading and writing its `public.Group` / `User` / `Session` directly, so a partnership *was* a
Trackmarg group. Two things remain from that:

- **The conventions.** Group codes are minted as `TM` + 4 digits and stored normalized
  (`TM4821`) using Trackmarg's own `normalizeGroupCode` rules, then displayed as `TM-4821`, so
  a partner may type the code with or without the hyphen, in any case. PINs use the same
  PBKDF2 (100k iterations, `salt:hash`).
- **`0000_public_baseline.sql` is idempotent.** Applied to the old shared database it is a
  complete no-op, so pointing back there is a one-line change rather than a rebuild.

What is gone is the *linkage*. A group code in Ledger+ means nothing in the transport app, and
either may mint one the other already has. Tokens are still HMAC-signed with a secret derived
from `SESSION_SECRET` plus an `aud: 'ledger'` claim — which mattered enormously while the
secret was shared, and is now simply good hygiene.

---

## Running it

```bash
npm install
npm run db:migrate     # applies prisma/migrations/*.sql to the `ledger` schema
npm run dev            # API on :4000 + Vite on :5174 (proxying /api)
```

For a production-style run, where Express serves the built frontend itself:

```bash
npm start              # build frontend + backend, then serve everything on :4000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | API (tsx watch) and Vite together |
| `npm run dev:api` / `dev:web` | Either half on its own |
| `npm run build` | Typecheck + build the frontend to `dist/` |
| `npm run deploy` | Pull, migrate, rebuild; `-- --restart` also restarts the server |
| `npm run watch` | Auto-deploy whenever the running build falls behind the code |
| `npm run release` | Publish the current tag's notes as a release manifest |
| `npm run start:public` | Build, serve, and open a Cloudflare Tunnel (see below) |
| `npm run tunnel` | Tunnel only, against an already-running server |
| `npm run db:migrate` | Apply pending SQL migrations via `DIRECT_URL` |
| `npm test` | The two-user acceptance suite (hits the real database) |
| `npm run lint` | Typecheck both halves |

`.env` carries `DATABASE_URL` (pooled, :6543), `DIRECT_URL` (direct, :5432, for DDL) and
`SESSION_SECRET` — all belonging to this app's own Supabase project.

---

## Putting it on the internet

`npm run start:public` builds the app, serves it, and opens a Cloudflare Tunnel — a public
HTTPS address for the server running on this PC, with no router ports opened and no trouble
with CGNAT. See [CLOUDFLARE.md](CLOUDFLARE.md) for the throwaway URL, the permanent
domain-backed setup, and running both as Windows services.

Two things this required:

- **`/api` is served `no-store`.** Behind a CDN, a cached `/api/bootstrap` would show a partner
  yesterday's balances with nothing to indicate it was stale. Static assets still cache.
- **Live sync degrades gracefully.** Cloudflare quick tunnels accept an SSE stream and then
  buffer it indefinitely (measured: nothing after 8s, versus first byte at 0ms on localhost).
  The client waits 6s for the stream's handshake and, if it never comes, polls every 10s
  instead. Instant where SSE works, a few seconds behind where it does not, never silently
  stuck.

---

## Shipping an update

```bash
git commit -m "..." && git push     # on your machine
npm run deploy -- --restart         # on the machine serving the app
```

**A commit does not reach anyone by itself, and neither does a push.** The update prompt is
driven by `GET /api/version`, which reports the build the *server* is running - and the server
only learns about a new commit when the code is pulled, rebuilt and restarted. `npm run deploy`
is that step: pull, install if dependencies moved, migrate, build, and (with `--restart`) swap
the running process. Migrations run before the new build goes live, which is safe precisely
because they are additive - the old build keeps serving against the migrated database until
the moment it is replaced.

### Naming a version

The build stamp answers *is the server newer than this client* — a fact about bytes, and the
right trigger. It cannot answer the human half: a commit hash is not a version name, and
"9773129 is available" tells a partner nothing about whether to care.

```bash
git tag -a v1.0.1 -m "Dark theme" -m "Ledger search"
git push origin v1.0.1
npm run release
```

Each line of the annotated tag becomes one release-notes bullet; a line containing
`[force-update]` makes the update mandatory. `npm run release` publishes that as a
`version.json` asset on a GitHub Release in **`Sudarshan357/ledger-plus-releases`** — a
separate **public** repo, so the server reads the manifest with no credential while the
source repo stays private. It reuses the credential git already holds, so there is no token
to create.

The server merges it into `/api/version` as an additive `release` field, and serves it alone
at `/api/app-version`. Every failure mode degrades to `null` rather than erroring — no
release yet, GitHub unreachable, malformed manifest — and the prompt simply shows no name or
notes. The flow (and the `[force-update]` convention) follows
[mystio1/excavator-manager](https://github.com/mystio1/excavator-manager).

`npm run release` also **builds and uploads a signed APK**, and puts its `apkUrl` and
`apkSha256` in the manifest — that is what the Android app downloads. Use `--no-apk` for a
web-only change; the manifest then carries no APK and phones correctly see no new version.

Each build is stamped with the git commit and a timestamp (`scripts/build-info.mjs` →
`build-info.json`). Vite bakes that into the bundle; Express serves it at `GET /api/version`.
A running client compares the two on launch, whenever it returns to the foreground, and every
15 minutes — and shows a slim **Update available** bar when the server has moved on. It
reloads only when the user taps it, never on its own, so nothing half-typed is thrown away.

## The Android app

```bash
npm run apk                    # debug build → ledger-plus.apk, for your own phone
npm run release                # signed release build, published for everyone
```

The web build is packaged **inside** the APK. There is no `server.url`: the WebView never
loads a remote page, every screen is a local file, and the only thing crossing the network is
`fetch()` to the API — a native app calling a backend, not a browser loading a website.

That is a trade, and worth being explicit about. An earlier version was a thin shell around
`https://ledger.trackmarg.in`, which got every web deploy for free; the cost was that it *was*
only a URL — no version of its own, nothing on the phone but a viewport, and nothing for
Android to sign or update. Bundling means the phone runs a real build, and a new build reaches
it as a new APK.

**Two audiences, two update paths, one manifest.** `useAppUpdate` asks a different question on
each. A browser asks *is the server's bundle newer than mine* and applies it with a reload. The
app asks *is there a released APK with a higher `versionCode` than the one installed* — using
build time there would nag on every web deploy, including ones with no APK behind them, and
offer an update that cannot be delivered.

The app updates itself in place: `UpdateInstallerPlugin` streams the APK to app-private
storage, checks it against `apkSha256`, and hands it to Android's own installer. Nothing
happens silently — the system confirmation screen always appears, and the user must have
granted *install unknown apps* first, which the banner detects and deep-links to. Whether an
install completed is not observable from inside the app; the authoritative signal is the
`versionCode` no longer matching on the next resume.

### Offline

The app carries its whole UI, so opening it with no network shows Ledger+ rather than a
browser error. That alone is not much use — the furthest you could get is the PIN screen,
because unlocking asks the server. So the device keeps two things: a snapshot of the last
successful load, and a PBKDF2 verifier that can check a PIN locally.

The server stays the authority whenever it can be reached. Only a *network-level* failure
falls back to the local check — a 401 is a wrong PIN and stays wrong, because a local retry
could only ever overrule a correct rejection. The verifier is written only after the server
has accepted that PIN, so the two can never disagree, and both it and the snapshot are wiped
on logout and on any 401: the next person to sign in on that phone must not be able to unlock
into the last partner's books. Offline guessing is rate-limited on the device (5 attempts,
then 15 minutes), because the server's rate limiter is exactly what is missing there.

**Offline is read-only, and says so.** Writes are refused rather than queued. This ledger has
two authors, and a queued entry replayed on reconnect would land against a state that had
moved on — the other partner may have settled the session or entered the same expense from
their own phone. In an app whose purpose is agreeing on money, quietly wrong is far worse than
plainly unavailable. The banner names the age of the figures, not just the fact, because
"synced moments ago" and "synced yesterday" are the difference between numbers you can act on
and numbers you cannot.

### The signing key

`~/.ledger-plus/` holds the release keystore and its password. **Back that folder up.** Android
identifies an app by its signature, so an update only installs over an existing Ledger+ if it
was signed with the same key. It cannot be regenerated: lose it and every phone with the app
has to uninstall before it can install again. It is deliberately outside the repo, and
`npm run release` refuses to publish a debug-signed APK rather than stranding everyone who
installs it.

**Until they tap it, the old build keeps running.** That is only safe because API changes here
are additive, which is a rule, not an accident:

- New Prisma migrations **add**; they never drop or rename a column an older client reads.
- New API fields are additive; existing response shapes keep their meaning.
- New endpoints are fine. Changing what an existing one *does* is not.

When you genuinely cannot keep that promise, set `MIN_CLIENT_BUILD_TIME` (epoch ms, normally
the build time of the release that broke compatibility). Clients older than that get a
full-screen **Update now** instead of the dismissible bar, rather than failing in confusing
ways. Leave it unset and every update stays optional.

Caching is what makes this work at all, so it is set explicitly in `backend/src/static.ts`:
`index.html` is `no-cache` (its name never changes and it names the current bundle), hashed
assets under `/assets` are `immutable` for a year, and everything under `/api` is `no-store`.
Get that wrong behind Cloudflare and a deploy simply never reaches anyone's phone.

**Your data is not involved in an update.** Every figure lives in Postgres; the bundle carries
none of it. `localStorage` survives the reload, so the session, group and theme come back
unchanged and nobody is signed out. Verified by fingerprinting a partnership's entries and
frozen settlement figures across a full rebuild-and-restart — identical hash, both partners'
tokens still valid.

---

## Migrations

Ledger+ does **not** use `prisma migrate deploy`. That command records state in
`public._prisma_migrations`, which belongs to the transport app's history — writing to it
would make that app report migrations it has never heard of. Instead,
`backend/src/scripts/applyMigrations.ts` applies `prisma/migrations/*.sql` in filename order
and tracks them in `ledger._migrations`, with a checksum guard that refuses to run if an
already-applied file has been edited. Each migration runs in its own transaction.

Add a new `NNNN_name.sql` file to migrate; never edit an applied one.

---

## The rules, and where they are enforced

Every one of these is enforced **server-side, from the auth token** — the UI hides controls to
avoid offering an action that would fail, not as the safeguard itself.

**Ownership and attribution.** An entry carries two identities: the `ownerId` (whose entry it
is, which is what drives the settlement) and the `createdById` (who actually typed it). A
partner may record *on behalf of* the other — one person often keeps the books for both — but
only for someone the database confirms is a partner in the same group. `createdById` always
comes from the verified session and is never read from the request body, so however an entry
is attributed, who entered it cannot be forged. Editing or deleting requires that you are the
owner **or** the creator: creator-only would let one partner pile entries onto the other's
side of the books with no way to push back.

**Two-person delete.** Deleting moves a row to Deleted Records with every original field
intact (`deletedAt`/`deletedById` on the row itself — nothing is copied or summarised).
Permanent deletion requires `deletedById !== you`, so:

```
A deletes  →  only B can destroy it
B deletes  →  only A can destroy it
```

Before the row goes, a full snapshot is written to `ledger.LedgerAuditLog` inside the same
transaction. That entry is the only trace that survives, which is exactly why it exists.

**Group isolation.** Every repository function takes a `groupId` and folds it into the `WHERE`
clause. There is deliberately no "find by id" that does not also require the group, so an id
from another partnership cannot resolve.

**Sessions.** Exactly one active session per group, enforced by a partial unique index
(`WHERE status = 'active'`), not just by the route. `POST /settlement/close` takes a
`SELECT … FOR UPDATE` on the active session, so two partners tapping *Start Fresh Session* at
the same moment cannot produce two settlements for one period; the second gets a clean 409.

---

## The settlement maths

All arithmetic runs on **integer paise** (`backend/src/services/money.ts`). Floating-point
rupees drift, and a partnership ledger whose two sides stop reconciling is worse than useless.

Each partner's `net` is what they took in minus what they paid out — i.e. how much of the
partnership's money they are currently holding, negative meaning they are out of pocket.
Profit is the sum of those nets, and each partner is entitled to an equal share:

```
shareBalance = (totalProfit ÷ partnerCount) − net
```

Negative balance = holding more than your share, so you pay it out. Positive = you receive it.

**The direction is easy to get backwards, so state it plainly: the partner who collected the
cash is the one who owes money, not the one who is owed it.** For two partners the transfer
reduces to `|netA − netB| ÷ 2`. Computing it once, that way, rather than rounding each balance
separately, guarantees the two figures are exact mirrors and the payment leaves both square —
rounding independently strands a paise that shows up forever as a 1p dashboard imbalance.

Worked through with the reference figures:

| | Received | Expenses | Net | Share balance |
| --- | --- | --- | --- | --- |
| Sahadev Pol | ₹1,10,000 | ₹2,000 | ₹1,08,000 | **−₹54,025** (pays) |
| Pandurang Patil | ₹0 | ₹50 | −₹50 | **+₹54,025** (receives) |
| **Total** | ₹1,10,000 | ₹2,050 | **₹1,07,950** | ₹53,975 each |

→ *Sahadev Pol needs to send Pandurang Patil ₹54,025.* Sahadev is holding ₹1,08,000 against an
entitlement of ₹53,975, so he hands over the surplus. The acceptance suite asserts every one of
these numbers, plus the direction on its own in a minimal case.

> **This deliberately differs from the original reference screenshots**, which showed
> "Pandurang Patil owes Sahadev Pol" for exactly these figures. That direction is inverted:
> it has the partner who spent ₹50 paying the partner sitting on ₹1,08,000. Ledger+ pays out
> from whoever holds the surplus.

**Scoping.** Home, the Ledger screen and settlement are **session**-scoped — they answer
"where do we stand right now". Reports are **calendar**-scoped: "August 2026" means everything
in August 2026, whichever session it fell in. Closed sessions stay readable in
Settings → Settlement Details.

---

## Layout

```
prisma/
  schema.prisma            public (mirrored) + ledger (owned) models
  migrations/*.sql         applied by the script below, tracked in ledger._migrations
backend/src/
  app.ts  index.ts  env.ts  static.ts
  db/repositories/         every query scoped by groupId
  middleware/              auth (token → user → partnership), rate limits, errors
  routes/                  auth, account, transactions, deleted, settlement, reports, export, events
  services/                money (paise maths), tokens, passwords, codes, sse, serializers
  scripts/applyMigrations.ts
  acceptance.test.ts       the section-44 two-user flow, end to end
src/
  screens/                 Home, Ledger, Reports, Settings, Add, Record Settle, auth/, settings/
  components/              nav, transaction row, chart, icons, shared UI
  lib/                     Indian currency + date formatting, categories, PDF/CSV export
  state/AppContext.tsx     session, lock gating, SSE sync
```

---

## Notes worth knowing

**Every launch asks for the PIN.** A stored token means *locked*, never *straight in*. Unlock
is a real server check against the PIN hash; app state is cleared on lock, so nothing is held
in memory behind the lock screen.

**Live sync** is server-sent events keyed by group code, plus a re-sync when the tab becomes
visible again — a backgrounded phone loses the socket silently, and both partners' screens
have to agree after a commute.

**Categories are type-aware.** Expenses use Materials / Labour / Machinery / Transport / Other;
receipts use Sales / Job Work / Advance / Other. The single list in the brief would have put
"Labour" in the income picker and left no way to label the "Sales" and "Job Work" entries the
reference screens show. The server rejects a category that does not belong to the type.

**PDFs say "Rs." rather than "₹".** jsPDF's built-in fonts have no rupee glyph, and embedding a
Unicode font would add a few hundred KB to the bundle for one symbol. The CSV is UTF-8 with a
BOM (so Excel reads it correctly) and carries plain signed numbers, which is what a spreadsheet
wants.

**The export chunk is lazy-loaded.** jsPDF and its dependencies are about 60% of the app's
weight; making every launch pay for them over a mobile connection would be the wrong trade.
Main bundle is ~283 KB (~87 KB gzipped).

**Deleted records cannot be restored,** only viewed or permanently removed, exactly as
specified. If you want an undo path later, the natural rule is to give restore the same
"other partner authorises" requirement that permanent deletion has.
