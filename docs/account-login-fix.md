# Existing-account login correction

Existing accounts and password hashes are preserved. Do not create a replacement account to recover from a connection error.

## Changes

- One shared Prisma client/pool is used across API modules, instead of separate clients in each module.
- Registration hashes the password before opening a database transaction, then commits the account and initial refresh session together.
- Welcome notification delivery does not delay or fail a successful registration response.
- Database connectivity/pool outages return retryable HTTP 503 responses. They no longer make a valid access token look invalid or trigger unnecessary sign-out.
- Duplicate signup returns the mobile user to sign-in with their identifier filled in. Network-error messages explain that the existing account can be reused.
- The LAN Expo API setting uses localhost; the existing resolver replaces it with the actual Expo host address. This avoids hardcoded Wi-Fi IPs. Tunnel mode still needs an explicit reachable API address.

## Start the corrected backend

From the project root:

```powershell
npm.cmd run build --workspace=@rcm/api
npm.cmd run start --workspace=@rcm/api
```

Keep the backend terminal open. Build once after API code changes; the start command runs the compiled API without waiting for a watch-mode compilation. For development with live code recompilation, use npm.cmd run dev:api instead.

Restart Expo from apps/mobile to reload the API setting, then sign in using the original email/phone and password. Check the API health URL from the phone if a connection error remains.

## Verification (2026-10-10)

- API build and all 63 API tests passed; focused authentication/availability tests passed after the final token-payload guard.
- Mobile TypeScript, lint, web build, and all 26 mobile tests passed.
- Five live browser acceptance tests passed against an isolated database, including account registration, logout, repeated sign-in using uppercase email and phone, duplicate signup recovery, session refresh, and offline logout.
- Repeated existing-account API sign-ins took approximately 1.5–4.5 seconds on this development computer during the test run. The cold registration request took approximately 11 seconds. These are observations under this machine's load, not guaranteed response times on other devices.
- The original database still contained its seven existing accounts; the account-reuse tests created accounts only in the separate acceptance database.
- The corrected compiled API was started in a visible PowerShell window. Both localhost and the current Wi-Fi health URL returned HTTP 200 with status ok, approximately 0.5 seconds after the requests started.
