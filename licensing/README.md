# Licensing — selling subscriptions for your whispr-open builds

whispr-open ships an **optional, honor-system** subscription gate for people
who distribute prebuilt binaries. It is a tiny Cloudflare Worker
([`worker/worker.js`](worker/worker.js), ~40 lines) that answers
`GET /check?key=<license-key>` with `{"active": bool, "expires": "YYYY-MM-DD" | null}`
by looking the key up in a Cloudflare KV namespace. You manage subscribers
entirely from the `wrangler` CLI — no database, no backend code, and the whole
thing fits in Cloudflare's free tier.

## One-time setup

You need a (free) Cloudflare account and Node.js. All commands run from
`licensing/worker/`:

```sh
npx wrangler login                          # opens the browser once
npx wrangler kv namespace create LICENSES   # prints the namespace id
```

Paste the printed id into `wrangler.toml` (replace
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`), then:

```sh
npx wrangler deploy
```

Wrangler prints your worker URL, e.g.
`https://whispr-license.<your-subdomain>.workers.dev` — that URL is your
license server. (If you prefer scaffolding from scratch, `npm create
cloudflare` works too, but the bundled `worker.js` + `wrangler.toml` are all
you need.)

## Managing subscribers (CLI only)

A license key is any string you invent — `uuidgen` output works fine. The KV
value is the subscription's expiry date, `YYYY-MM-DD`; the key is active while
today (UTC) is on or before that date.

```sh
# Add a subscriber (paid until end of 2026):
npx wrangler kv key put --binding LICENSES --remote "<license-key>" "2026-12-31"

# Extend: put again with a later date (same command, new date).
# Revoke: delete the key, or put a past date.
npx wrangler kv key delete --binding LICENSES --remote "<license-key>"

# See everyone:
npx wrangler kv key list --binding LICENSES --remote
```

(`--remote` targets the deployed namespace — Wrangler v4 otherwise writes to a
local dev copy. On old Wrangler v3, drop the flag.)

Test it with curl:

```sh
curl "https://whispr-license.<your-subdomain>.workers.dev/check?key=<license-key>"
# -> {"active":true,"expires":"2026-12-31"}
curl "https://whispr-license.<your-subdomain>.workers.dev/check?key=nope"
# -> {"active":false,"expires":null}
```

## Hooking it up to the app

Give each customer their license key, and either have them paste the worker
URL + key into **Settings → License**, or prefill the default
`license.server_url` in the settings defaults before building your paid
distribution so customers only enter their key.

## How the app behaves

- With an **empty server URL** licensing is entirely off — the open-source default.
- The app calls `/check` at startup and hourly, plus when license settings change.
- New installs get a **7-day trial** before any key is needed.
- **Offline keeps working**: the last successful answer is cached indefinitely,
  and with no cache at all the app stays unlocked (honor system). Only an
  explicit `active: false` from your server blocks dictation.

**Open-source caveat:** whispr-open is MIT-licensed with no obfuscation or
anti-tamper — anyone can build an unlocked copy from source. This gate exists
for honest customers of *your prebuilt binaries*, not as DRM.
