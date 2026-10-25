# Swarna Sethu — Jewellery Billing

| Folder | What it is |
|---|---|
| `backend/` | Express API on Firestore. All bill maths, invoice numbering, auth and permissions live here. |
| `frontend/` | Shop desktop app (React + Electron): billing, rates, inventory, customers, reports, staff, admins. |
| `admin_frontend/` | License portal for the software provider: issue/renew/deactivate licenses, approve owner mobile changes. |

## Try it without Firestore (demo mode)

```bash
cd backend && npm install && npm run demo      # in-memory data, sample shop, prints logins
cd frontend && npm install && npm start        # http://localhost:3000
cd admin_frontend && npm install && npm start  # http://localhost:3001
```

Demo logins: license `SW-DEMO-2026-GOLD`, `owner / owner1234` (or `ravi / ravi12345`, billing only).
Admin portal: `admin / admin-demo-123`. Stock item codes: `NK-101`, `RG-205`, `BG-310`, `ER-412`.

## Real setup

1. `cd backend`, copy `.env.example` to `.env` and fill it in (it explains every value).
   - Admin portal password: `npm run hash-password -- "your-password"` → paste into `ADMIN_PASSWORD_HASH`.
   - Put the Firebase service-account JSON at `backend/serviceAccountKey.json` (git-ignored).
2. One-time data upgrade for existing Firestore data: `npm run migrate` (dry run), then `node migrate.js --apply`.
3. `npm start` → API on port 5000.
4. Frontends: copy `.env.example` to `.env` if the API isn't on `http://localhost:5000`.

Without `FAST2SMS_API_KEY` the OTP for "forgot password" is printed in the backend console.

## Tests

```bash
cd backend && npm test        # billing engine + full API (in-memory Firestore)
cd frontend && npm test
```

## How billing works

`backend/lib/billing.js` is the single billing engine. The desktop app uses a copy
(`frontend/src/shared/billing.js`, regenerated automatically on `npm start` / `npm run build`)
for the live preview; the server recomputes every invoice on save and ignores totals sent by the client.

- **Sale** — gold value (net wt incl. wastage × purity rate) + making + stones, GST 3% (HSN 7113).
  Old gold exchange is valued by fine weight at the 24K rate and deducted after tax.
- **Job work** — customer's gold is settled in fine weight. Gold the shop adds is billed at the
  24K rate with 3% GST (HSN 7108); making/stone labour is job work at 5% GST (SAC 9988). Surplus customer gold is credited.
- CGST+SGST within the shop's state, IGST otherwise. PAN required above ₹2 lakh; cash of ₹2 lakh or more is blocked.
- Invoice numbers: `PREFIX/26-27/0001`, consecutive per financial year (Firestore transaction). Cancelled invoices keep their number.

## Deploy on Vercel

One GitHub repo → **three Vercel projects** (Vercel → Add New → Project → import this repo, once per row;
set **Root Directory** as shown). Do the backend first because the websites need its URL.

| # | Root Directory | What it serves | Environment variables |
|---|---|---|---|
| 1 | `backend` | The API (runs as a serverless function) | everything in `backend/.env.example` — see below |
| 2 | `frontend` | The shop billing website | `REACT_APP_API_URL` = the backend's URL |
| 3 | `admin_frontend` | The license admin website | `REACT_APP_API_URL` = the backend's URL |

Backend variables: `ENCRYPTION_SECRET`, `TOKEN_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` (paste just the hash starting with `$2b$` —
**without** the single quotes that the local `.env` file uses), `FIREBASE_SERVICE_ACCOUNT_JSON` (base64 of the key file), `CORS_ORIGINS`, and optionally
`FAST2SMS_API_KEY` and `GOLDAPI_KEY`.

Order: deploy `backend` → copy its URL → deploy `frontend` and `admin_frontend` with `REACT_APP_API_URL` set to it →
put the two website URLs in the backend's `CORS_ORIGINS` → redeploy the backend. `REACT_APP_*` values are baked in at build time,
so changing one needs a redeploy. Check `https://<backend-url>/health` returns `{"ok":true}`.

Notes
- On Vercel the login/OTP rate-limit counters live in Firestore (`rateLimits` collection). Optional: in the Firebase console add a
  TTL policy on `rateLimits` → field `expiresAt` so old counters are cleaned up automatically.
- Without `FAST2SMS_API_KEY`, OTPs are only written to the Vercel function logs. Set the key for real use.
- The website works in any browser. **Save PDF** opens the print dialog (choose *Save as PDF*); the one-click PDF save and the
  ESP32 key dongle are features of the Windows desktop app.
- Never commit `.env` or the service-account file — they're git-ignored. Give secrets to Vercel through its Environment Variables.

## Desktop app

The Windows app (`cd frontend && npm run dist`) should talk to the same central backend: set `REACT_APP_API_URL` in `frontend/.env`
before building. Do not install the backend or the Firebase service-account key on shop PCs.

## Goldsmith logins & work orders

- **Give a login:** Staff → *🔑 Give login* next to a staff member (owner only). They sign in with the shop's license key, their username and password, and see only **My Work** and **Notifications** — no billing, stock, customers or rates.
- **Assign work:** *Work Orders → New work order*, or choose a goldsmith who has a 🔔 on an invoice and a work order is created automatically.
- **Flow:** Assigned → In progress → Completed (goldsmith, with finished weight) → Verified & closed, or sent back with a note (owner). Each step notifies the other side; the apps refresh every ~20 s.
- **Permissions:** Admin Management now has *Barcode* and *Work Orders* switches next to Invoice / Inventory / Staff / Reports.

## Job work for a customer's gold (two phases)

**Phase 1 — the order** (Invoices → New Invoice → *Job Work*): one card with what is to be made (description, purity dropdown) and the customer's gold received; the advance in its own card. It gets an invoice number and an automatic **job code** (`JW00001…`; stock items use `SS00001…`). There is no bill yet and no HUID, wastage, making or stones. The printout is an *order receipt*.

**The work:** the goldsmith starts and completes it in *My Work*, entering the **finished weight and the wastage**. The invoice becomes **Ready for pickup** and the owner is told to call the customer.

**Phase 2 — pickup** (Invoices → *Unfinished job work* → open → **Finalize & deliver**): the goldsmith's weight and wastage are pre-filled; add the HUID, making and stone charges. The bill is prepared under the same number and the advance is deducted.

**What the bill charges:** the customer's own gold is only *weighed* — never priced or paid for. The bill is the **new gold the shop adds** (needed net fine − his fine, 24K rate, 3% GST) + **making + stones + wastage** (job work, 5% GST). If he gave more gold than needed, the surplus is returned in grams. Pending job work isn't counted as a sale (dashboard, reports, GST) until delivered. *Receive payment / Add advance* works on any invoice.
