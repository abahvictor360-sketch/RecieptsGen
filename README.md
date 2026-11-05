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
