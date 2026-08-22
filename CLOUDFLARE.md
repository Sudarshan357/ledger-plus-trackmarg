# Running Ledger+ over the internet (Cloudflare Tunnel)

By default the app is only reachable from the PC it runs on, or from phones on the same WiFi.
A **Cloudflare Tunnel** gives it a public HTTPS address without opening a single port on your
router, and it works behind CGNAT — which most Indian home and mobile connections use, and
which is why plain port forwarding usually fails.

This is the same approach the Trackmarg transport app uses, and `cloudflared` is already
installed on this machine.

Nothing about the app changes. The Node server still runs here; Cloudflare just carries
traffic to it.

```
partner's phone ──HTTPS──> Cloudflare edge ──tunnel──> this PC :4000
                                                       Express + Prisma
                                                            │
                                                            └──> Supabase
```

---

## 1. Quick test — one command, no domain

```bash
npm run start:public
```

That builds the app, starts the server, and opens a tunnel. Look for a line like:

```
https://random-words-1234.trycloudflare.com
```

Open it on either partner's phone. That URL is live until you close the terminal, and you get
a **different one** next time — fine for testing, not for daily use.

To run the tunnel against an already-running server, use `npm run tunnel` on its own.

---

## 2. Permanent address — needs a domain

A fixed address like `https://ledger.yourbusiness.com` that survives restarts. You need a
domain on a free Cloudflare account (~₹700–900/year from any registrar; a subdomain of one you
already own works too).

1. Add your domain at https://dash.cloudflare.com and set the nameservers it gives you at your
   registrar.

2. Log `cloudflared` in — this opens a browser to pick the domain:
   ```bash
   cloudflared tunnel login
   ```

3. Create the tunnel (once). It prints a Tunnel ID and writes a credentials JSON:
   ```bash
   cloudflared tunnel create ledger-plus
   ```

4. Point a hostname at it (once):
   ```bash
   cloudflared tunnel route dns ledger-plus ledger.yourbusiness.com
   ```

5. Create `C:\Users\<you>\.cloudflared\config.yml`:
   ```yaml
   tunnel: <the Tunnel ID from step 3>
   credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

   ingress:
     - hostname: ledger.yourbusiness.com
       service: http://localhost:4000
     - service: http_status:404
   ```

6. Run it:
   ```bash
   npm run server          # in one terminal
   cloudflared tunnel run ledger-plus   # in another
   ```

### Surviving reboots

Install both pieces as Windows services so nothing needs a terminal open:

```bash
# Run as Administrator
cloudflared service install
```

For the app itself, either add `npm run server` to Task Scheduler ("At startup", "Run whether
user is logged on or not") or wrap it with a service manager such as
[NSSM](https://nssm.cc/). The server must be listening before the tunnel is useful, but the
tunnel retries on its own, so start order does not matter.

---

## Things worth knowing

**Live sync falls back to polling through a tunnel.** Ledger+ pushes changes between partners
over server-sent events. Cloudflare **quick tunnels** (`trycloudflare.com`) accept the stream
and then buffer it indefinitely — measured here as *nothing at all after 8 seconds*, against a
first byte at 0 ms on localhost. The app detects this: if the stream's handshake does not
arrive within 6 seconds it closes it and polls every 10 seconds instead, so a partner's entry
still appears, just a few seconds later rather than instantly. Nothing is lost and no error is
shown. On localhost, LAN, and named tunnels that do stream properly, SSE is used and updates
are immediate. Worth re-testing on your own domain — named tunnels often behave better than
the throwaway ones.

**The API is never cached.** Everything under `/api` is served `no-store`. Without that,
Cloudflare could cache a balance and show a partner yesterday's figures with no hint it was
stale. Static assets are still cached normally.

**HTTPS is a bonus, not just decoration.** Over a tunnel the app runs in a browser "secure
context", which is what lets `crypto.randomUUID()` work — over plain LAN HTTP it falls back to
a weaker id generator.

**Your PC has to be on.** A tunnel exposes this machine. If it sleeps or loses internet, the
app is down for both partners. (Check Windows sleep settings.)

**It is now on the public internet.** Access needs a group code, a phone number and a PIN;
sign-in is rate limited to 5 attempts a minute and PIN checks to 10. That is reasonable, but a
4-digit PIN is only 10,000 combinations. If you want a second lock on the door, put
[Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in
front of the hostname — free for up to 50 users, and it can require an email one-time code
before the app is even reachable.
