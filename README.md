# RecieptsGen

Create clean invoices and receipts in the browser and save them as PDF.

## Features

- Invoice and receipt modes with automatic UNPAID / PAID / PARTIALLY PAID badge
- Billed-to, payment method, reference and transaction ID
- Line items with icon (built-in set or your own uploaded logo), vendor, coverage, quantity, description
- Item logos shown in the document header
- Discount, tax and an optional approximate currency conversion line
- One-click "Make receipt" from an invoice
- Auto numbering (`INV-2026-0001`), saved documents, JSON backup export and import
- Download PDF uses the browser print dialog (US Letter, vector text)

All data stays in the browser (localStorage). No server or account needed.

## Run locally

Any static server works:

```bash
npx http-server . -p 5178
```

## Deploy

Static site, no build step. Deployed on Vercel straight from `main`.

## Pro backend (Supabase + Flutterwave + Resend)

- `supabase/migrations/001_init.sql`: tables, row level security, free export quota (2 receipts + 1 invoice per account).
- `supabase/functions/pay`: Flutterwave checkout, verify and webhook (`?webhook=1`).
- `supabase/functions/send-email`: emails a document to a client (Pro, 50 a day).
- `supabase/functions/recurring`: creates repeating invoices, run daily by pg_cron.
- `config.js`: Supabase URL and publishable key for the browser.

Edge function secrets (Supabase dashboard > Edge Functions > Secrets):
`FLW_SECRET_KEY`, `FLW_SECRET_HASH`, `RESEND_API_KEY`, `RESEND_FROM`, `APP_URL`, optional `FLW_PLAN_ID`.
