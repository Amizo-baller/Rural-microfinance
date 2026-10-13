# Module 21 automated acceptance

The user selected automated checks only and reported that no phone or rural test participant was available. This run tests the exported mobile web interface and actual local services. It does not represent physical-device, TalkBack/VoiceOver, SMS-provider, or participant testing.

## Reproduce

Prerequisites: the installed Microsoft Edge browser, a reachable local PostgreSQL server configured in `apps/api/.env` with permission to create a separate test database, and compiled contract artifacts.

From the repository root:

```powershell
npm.cmd run build --workspace=@rcm/api
npm.cmd run compile --workspace=@rcm/contracts
npm.cmd run build:review --workspace=@rcm/mobile
npm.cmd run test:acceptance --workspace=@rcm/mobile
```

The suite creates a uniquely named local database, applies the repository SQL migrations, and seeds fictional accounts. It starts the real API, a new isolated Hardhat network/contract, a reset-delivery receiver, and a static preview. It does not update the existing application database or use a live blockchain wallet. Services stop at the end; test databases remain available for examining the evidence.

Ports used: 3010 (test API), 4173 (preview), 4180 (reset receiver), 8555 (isolated chain). Generated credentials and fixtures are under ignored `.acceptance/`; do not use these credentials outside the test run.

## Coverage

- All 22 requested screen areas, plus the delivered reset-password link.
- Phone-only registration, inline validation, keyboard navigation, reset confirmation, and login with the changed password.
- Actual savings deposits, application submission, API approval/disbursement, loan details, repayment recording, stored balances, transactions and reports.
- Actual attendance persistence and notification read actions.
- Member account settings and administrator settings edits with API access restrictions.
- Profile connection failure and successful retry.
- A 360px mobile viewport and a 320px viewport with text increased to 150%.
- Automated axe checks for applicable WCAG 2.0/2.1 A/AA rules, screenshots, and horizontal overflow checks.
- Duplicate financial references must not increment balances twice; other members cannot inspect a private loan.
- Blockchain proof recording, verified database/chain hashes, and a negative result for a mismatched hash.
- Reset delivery through an actual HTTP webhook receiver, single-use reset tokens, old-password rejection, and successful new-password login.

## Repairs discovered during acceptance

1. Added the missing reset-password route for delivered links, including validation, pending/error feedback and return to sign-in.
2. Added screen headings, navigation announcements, keyboard focus, visible web focus outlines and screen scroll reset.
3. Bounded long message banners so they do not consume the entire screen.
4. Named loading indicators for assistive technology.
5. Fixed successful blockchain recordings returning HTTP 500 because an event timestamp was a JavaScript BigInt. Receipt integers now serialize as exact decimal strings; verification booleans retain their values.
6. Corrected administrator currency formatting to preserve cents.
7. Added repeatable browser/live-service tests with screenshots, accessibility results and automatic cleanup of their own services.

## Evidence

The latest HTML report is `apps/mobile/acceptance-report/index.html`. Screenshots and failure traces are in `apps/mobile/acceptance-results/`. These generated artifacts are ignored by Git and recreated on each run.

Completed results: **5 acceptance scenarios passed**, **25 axe audits found no violations of the tested rules**, and **26 screen images were captured**. The 14 mobile regression tests, 2 new blockchain receipt tests, mobile TypeScript, API/mobile lint, API build and production web export passed.

The suite exercised error/retry handling. One transient database connection failure was also logged during the profile recovery scenario; the subsequent retry and all assertions passed. Database pools in the isolated harness are limited to two connections per client for this resource-constrained machine.
