# RAISE Cloud

Backend, admin panel and customer app for the RAISE self-checkout kiosk (`../RAISE`).

```
raise-cloud/
  supabase/   database schema + row-level security, Edge Functions, seed catalog
  admin/      store admin panel (Vite + TypeScript)
  app/        customer PWA (Vite + TypeScript, installable, works offline)
  shared/     design tokens, icons and helpers shared with the kiosk look
  scripts/    create-admin.mjs
```

## How the pieces connect

| Piece | Talks to Supabase as | Can do |
|---|---|---|
| Kiosk (`../RAISE`) | anon key + **kiosk device key** → `kiosk` Edge Function | read the catalog, identify customers (pass QR or NFC card), register, link cards, create orders, mark paid, heartbeat |
| Customer app | signed-in customer (row-level security) + `pass` Edge Function | own pass QR, points, receipts, shopping list, NFC card, claim a kiosk-made pass |
| Admin panel | signed-in admin (`admins` table) | everything: products and prices, live orders, customers and cards, kiosks |

- **Passes**: the QR holds `RAISE2.<pass id>.<signature>`. The signature is an HMAC made with `PASS_SECRET`, which never leaves the server, so passes can't be forged from page code. No name, phone or points are in the QR.
- **Prices** are always taken from the database at checkout; the kiosk can only supply a price for barcodes that aren't in the catalog (flagged as estimates).
- **NFC cards** are stored as `sha256("raise-nfc:" + uid)`, the same scheme on kiosk and phone.
- **Points**: 1 point per ₹10 on paid orders, added by the server.

## Local development

Needs Node 20+ and Docker.

```bash
npm install
npx supabase start                         # local stack on ports 545xx
cp supabase/functions/.env.example supabase/functions/.env   # set PASS_SECRET
npx supabase functions serve --env-file supabase/functions/.env
cp admin/.env.example admin/.env.local     # use the API URL + anon key from `supabase status`
cp app/.env.example app/.env.local
SUPABASE_URL=http://127.0.0.1:54521 SUPABASE_SERVICE_ROLE_KEY=... npm run create-admin -- you@example.com 'password'
npm run admin                              # http://localhost:5173
npm run app                                # http://localhost:5174
```

## Deploy to Supabase cloud

```bash
npx supabase login
npx supabase link --project-ref YOUR_REF
npx supabase db push                       # schema + policies
npx supabase secrets set PASS_SECRET="$(openssl rand -base64 48)"
npx supabase functions deploy kiosk
npx supabase functions deploy pass
# seed the catalog once: paste supabase/seed.sql into the SQL editor
SUPABASE_URL=https://YOUR_REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run create-admin -- you@example.com 'password'
```

In the Supabase dashboard: **Authentication → Providers → Email → turn off "Confirm email"** (the free plan's built-in email only sends a few messages per hour).

Then build the two apps (`npm run build`) and host `admin/dist` and `app/dist` as static sites, and put the project URL + anon key into `../RAISE/cloud-config.js`.

## Kiosk setup

Admin panel → **Kiosks → Add kiosk** → open the setup link once on the kiosk (or pass it to `setup-kiosk.sh` on a Raspberry Pi). The device key is stored on the kiosk and only its SHA-256 is kept in the database. Disable a kiosk or create a new link from the same page.
