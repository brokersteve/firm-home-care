# F.I.R.M. Home Care

A small web app for F.I.R.M. tenants and staff that sits next to Rentec Direct. For tenants it sends home-care
reminders by email, gives each home an emergency guide and local info page, and walks them through simple
troubleshooting (with diagrams) before a guided work order with photos lands in Rentec. For staff it has a phone
inspection tool (move-in, move-out, routine) that saves a PDF report to the property's files in Rentec, and a home
details form that writes the property's home details straight to Rentec, in a `[Home Care]` block of the property's
sticky note (Rentec's API can't read or write custom fields).

Rentec stays the source of truth. Each night the app copies the pilot properties (with their `HC ...` custom
fields), tenants and leases from the Rentec Open API, then sends whatever reminders are due.

## What's here

| File | What it does |
| --- | --- |
| `src/rentec.ts` | Rentec API client and field mapping. The only file that knows Rentec's paths and field names. |
| `src/sync.ts` | Nightly copy of properties, tenants and leases into the app's database. |
| `src/schedule.ts` | Which reminders are due for a tenant on a given day. |
| `src/email.ts` | Reminder wording and sending (Resend). |
| `src/guides.ts` | The 12 troubleshooting guides as yes/no trees, the autocomplete phrases, and the search. |
| `src/diagrams.ts` | Line drawings shown beside guide steps. |
| `src/fields.ts` | Every home detail (`HC ...` names, sticky-note labels), used by the home details form, emails and guides. |
| `src/inspection.ts`, `src/inspection-template.ts`, `src/report.ts` | Inspections, the room checklist, and the PDF report. |
| `src/photos.ts` | Photo storage (Cloudflare R2) and the browser-side photo shrinking. |
| `src/pages.ts`, `src/admin.ts` | Tenant pages and the admin dashboard. |
| `src/triage.ts` | Work order triage: category, urgency tier (Emergency, Urgent, Routine, Tenant responsibility), review flags, response targets. Plain rules F.I.R.M. can edit. |
| `src/maintenance.ts` | The maintenance tracker: tenant status page and close-out, staff work order board, status/waiting-on/owner approval, office alerts, status read back from Rentec, end-of-day summary. |
| `src/dispatch.ts`, `src/tracker.ts` | Sending a work order to a vendor, and the vendor job tracker (cost, owner price, invoice, paid, billed). |
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

Open `http://localhost:8787/admin/?token=dev-admin` (this signs the browser in as staff) and press "Sync and send due reminders now". The printed
emails contain each tenant's page link.

```sh
npm test            # unit tests
npm run typecheck
```

## Before the pilot

1. Confirm the paths, auth header and field names in `src/rentec.ts` against Rentec's API docs
   (https://secure.rentecdirect.com/api/v3/docs/, visible when logged in).
2. Create the Cloudflare D1 database (`wrangler d1 create firm-home-care`) and put its ID in `wrangler.toml`,
   and the photo bucket (`wrangler r2 bucket create firm-home-care-photos`).
3. Set `APP_URL`, `EMAIL_FROM`, `EMERGENCY_PHONE`, `RESIDENT_CONNECT_URL` and the pilot homes (`PILOT_ADDRESSES`, or `PILOT_PROPERTY_IDS`) in `wrangler.toml`.
4. Set the secrets: `wrangler secret put RENTEC_API_KEY` (and `RESEND_API_KEY`, `LINK_SECRET`, `ADMIN_TOKEN`).
5. `npm run db:migrate` then `npm run deploy`.

## Rentec API key

Name: FIRM Home Care. Read: Properties, Tenants, Leases, Work Orders, Lookup. Write: Properties (home details in the
sticky note), Work Orders, Messages, Files (inspection reports, work order photos). Nothing else. The key is only ever
stored as a Cloudflare secret and sent as the `X-API-Key` header (see Rentec's openapi.yaml).

## Maintenance tracker

Every tenant request is triaged when it comes in: urgency comes from the repair, not the tenant's pick (detectors
within 24 hours, doors, locks and windows that won't secure the same hour, a stuck disposal routine). Emergencies and
urgent requests email the office at once (emergencies also text `OFFICE_CELL`); routine ones are in the end-of-day
summary (22:00 UTC). Triage goes in the Rentec work order's private notes, so the tenant never sees "tenant
responsibility" flags. Staff move each request along on its work order page (status, visit date, waiting on, owner
approval over `OWNER_APPROVAL_LIMIT`), and the tenant follows it at `/t/.../requests` and taps Fixed or Still a
problem at the end. Every 15 minutes the app reads work order status from Rentec (Assigned, Parts, Work, Closed).
Rentec's API can't change a work order's status, so closing it in Rentec stays a manual step.

Renters insurance end dates aren't in Rentec's API, so tenants enter them on their Home Care page and staff can
correct them on the admin Tenants page. The sync never overwrites them.
