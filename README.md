# F.I.R.M. Home Care

A small web app for F.I.R.M. tenants that sits next to Rentec Direct's Resident Connect. It sends home-care
reminders by email, gives each home an emergency guide and local info page, and walks tenants through simple
troubleshooting before it files a work order in Rentec.

Rentec stays the source of truth. Each night the app copies the pilot properties (with their `HC ...` custom
fields), tenants and leases from the Rentec Open API, then sends whatever reminders are due.

## What's here

| File | What it does |
| --- | --- |
| `src/rentec.ts` | Rentec API client and field mapping. The only file that knows Rentec's paths and field names. |
| `src/sync.ts` | Nightly copy of properties, tenants and leases into the app's database. |
| `src/schedule.ts` | Which reminders are due for a tenant on a given day. |
| `src/email.ts` | Reminder wording and sending (Resend). |
| `src/guides.ts` | The 10 troubleshooting guides as yes/no trees, and the search that matches a tenant's words to a guide. |
| `src/pages.ts`, `src/admin.ts` | Tenant pages and the admin dashboard. |
| `src/index.ts` | Routes and the nightly scheduled job. |
| `dev/mock-rentec.mjs` | A fake Rentec API with two sample homes, for running locally. |

Tenants never log in. Every email carries a signed link to their own page; changing the link breaks the signature.

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars          # local settings; emails are printed, not sent
npm run db:migrate -- --local
node dev/mock-rentec.mjs &              # fake Rentec on port 8788
npm run dev                             # app on http://localhost:8787
```

Open `http://localhost:8787/admin/?token=dev-admin` and press "Sync and send due reminders now". The printed
emails contain each tenant's page link.

```sh
npm test            # unit tests
npm run typecheck
```

## Before the pilot

1. Confirm the paths, auth header and field names in `src/rentec.ts` against Rentec's API docs
   (https://secure.rentecdirect.com/api/v3/docs/, visible when logged in).
2. Create the Cloudflare D1 database (`wrangler d1 create firm-home-care`) and put its ID in `wrangler.toml`.
3. Set `APP_URL`, `EMAIL_FROM`, `EMERGENCY_PHONE`, `RESIDENT_CONNECT_URL` and `PILOT_PROPERTY_IDS` in `wrangler.toml`.
4. Set the secrets: `wrangler secret put RENTEC_API_KEY` (and `RESEND_API_KEY`, `LINK_SECRET`, `ADMIN_TOKEN`).
5. `npm run db:migrate` then `npm run deploy`.

## Rentec API key

Name: FIRM Home Care. Read: Properties, Tenants, Leases, Work Orders, Lookup. Write: Work Orders, Messages.
Nothing else. The key is only ever stored as a Cloudflare secret.
