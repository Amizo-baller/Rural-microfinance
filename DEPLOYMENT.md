# NestJS API deployment on Render

## Free-tier boundary

Use Render Free only for a temporary staging clone. Render documents Free
Postgres as 1 GB with a 30-day lifetime, no database backups, and a 14-day
post-expiry upgrade grace period before deletion. Free web services sleep after
15 minutes without traffic and can take about a minute to wake. Those limits
make Free unsuitable as the only database or always-available API for live
financial records. Keep the original database and existing client URL in place;
do not switch members to a temporary clone. See Render's current
[free instance limits](https://render.com/docs/free).

This repository now has a container build for the API. Choose a host that can
deploy a Dockerfile, provides a public HTTPS service, and lets you configure
server-side environment variables. Sign in to that host yourself; do not send
credentials or secret values in chat.

## Create a temporary hosted database and API

1. In Render, create **New → PostgreSQL**, choose **Free**, use the same region
   as the API, and select PostgreSQL 16 to match this machine's local dump tool.
   Do not select a paid plan or upgrade prompt.
2. In the database's Connect page, use its **External Database URL** only with
   `scripts/restore-render-database.ps1`. That script prompts for it with hidden
   input, checks the host is Render, verifies the target contains no user
   tables, and restores the verified backup in one transaction. It never uses
   `--clean` or `--create`; the original local database is read-only. The
   Render database's internal URL belongs in the API settings below.
3. Create a **Web Service** from the connected repository, select the **Free**
   instance, set the root directory to `.`, and leave the Dockerfile path at
   `Dockerfile`. Set health check path to `/api/health`; use the image's default
   start command. The API binds to `0.0.0.0` and honors Render's `PORT`.
4. Under service Environment, use Render's **Add from database** action to set
   `DATABASE_URL` to the new database's **Internal Database URL**. Do not paste
   either URL into chat, source control, or logs.
5. Run the controlled migration command only after the restore has succeeded:
   `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`. The
   container does not migrate or seed automatically. Do not run `prisma migrate
   dev` or the seed script against the hosted database.

## Environment variable checklist

Set these in Render's service Environment page. Enter secret values directly in
Render's secure value fields; never put them in this file or chat.

| Variable | Required value / purpose |
| --- | --- |
| `DATABASE_URL` | The new Render database's **Internal Database URL**; link via Add from database. |
| `NODE_ENV` | `production`. |
| `JWT_SECRET` | Generate a separate random staging secret (at least 32 characters). Do not reuse the local live secret. |
| `PAYMENT_PROVIDER` | `monime`, preserving the existing gateway. |
| `MONIME_ACCESS_TOKEN` | For staging use a Monime **test** token. Do not place a live token on a temporary cloned database. |
| `MONIME_SPACE_ID` | Existing Space ID for the selected Monime environment. |
| `MONIME_WEBHOOK_SECRET` | Secret belonging to the staging webhook; currently absent from the local environment. |
| `WALLET_AUTH_ORIGIN` | The public HTTPS app origin used for wallet sign-in. The current local value is not HTTPS. |
| `PORT` | Render sets this automatically; do not hard-code it. |

Optional settings preserve specific integrations: `GOOGLE_WEB_CLIENT_ID` for
Google sign-in; `BLOCKCHAIN_RPC_URL`, `BLOCKCHAIN_PRIVATE_KEY`, and
`CONTRACT_ADDRESS` for blockchain proofs; `MONIME_API_BASE_URL` defaults to
`https://api.monime.io`; `PAYMENT_RETURN_URL` is optional. In production,
password-reset delivery also requires `PASSWORD_RESET_WEBHOOK_URL` (and an
appropriate `PASSWORD_RESET_URL`); the current local environment does not set
that delivery integration. The mobile build must set
`EXPO_PUBLIC_API_URL=https://<your-api-host>/api` before it can call this API.

Do not attach the live Monime token to a staging clone: checkout confirmations
would update the clone instead of the original ledger. Once a durable production
database and cutover are approved, configure the live token on that production
service. This guide does not authorize switching the mobile app to the clone.

## Monime dashboard setup for staging

In Monime Developer → Access Tokens, create/confirm a test token scoped to this
Space and with the roles required by the staging payment tests. A live service
will also need `payouts:write`; the staging clone must not use the live token.
The payout API uses the default main account if no source account is supplied.

In the Monime dashboard's webhook settings, create a separate staging webhook
(keep the live webhook unchanged), set the staging HTTPS URL above, enable it,
and select
`payout.completed` and `payout.failed`. Keep HS256 signature verification on.
Copy the staging webhook signing secret directly into Render's
`MONIME_WEBHOOK_SECRET`, then restart/redeploy. Never put that value in this
file, source control, or chat.

The API's payout service deliberately rejects `mon_test_` tokens. This staging
copy can safely exercise member requests, rejection, and webhook signature
handling, but it cannot test an approval that creates a Monime payout. Do not
replace the test token with a live token on this temporary copy.

After the host health check passes, verify the hosted signature route without
a payout by running
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-monime-webhook-signature.ps1 -Endpoint https://<your-api-host>/api/webhooks/monime`.
It prompts for the signing secret without echoing it, sends a signed event whose
test payout ID cannot match a withdrawal, and expects HTTP 200 for the valid
signature and 401 for a deliberately invalid one. This verifies the hosted
signature handler; it does not claim a Monime-originated delivery. If Monime's
dashboard offers a test delivery, use it as an additional provider-to-host
check. Do not trigger a live payout to test webhooks.

Render account sign-in and repository authorization must be completed by the
account owner. The public HTTPS hostname is needed before the staging webhook
can be saved and tested. Free service sleep can delay webhook handling and
withdrawal reconciliation; use a non-expiring, always-on database/service for
live member withdrawals.
