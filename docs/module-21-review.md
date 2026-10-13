# Module 21 mobile UI/UX review

Reviewed 6 October 2026. All 22 requested screen areas are implemented in the Expo mobile app. The follow-up scope is automated acceptance only, as selected by the user. See [automated acceptance](module-21-automated-acceptance.md) for live-service/browser coverage and reproducible commands.

## Screen coverage

| #   | Screen                  | Implementation                                                             |
| --- | ----------------------- | -------------------------------------------------------------------------- |
| 1   | Splash                  | Branding and loading during saved-session restoration                      |
| 2   | Onboarding              | Three scrollable steps with Next, Skip and Get started                     |
| 3   | Login                   | Email/phone sign-in with pending and error feedback                        |
| 4   | Registration            | Phone-only or email registration, roles, optional group, inline validation |
| 5   | Forgot Password         | Reset request and confirmation; delivery requires an API provider          |
| 6   | Dashboard               | Permission-aware summary and shortcuts, administrator dashboard            |
| 7   | Profile                 | Editable contact details, save confirmation, failed-load retry             |
| 8   | Group                   | Community group list and group detail dashboard                            |
| 9   | Members                 | Search/filter list and member details                                      |
| 10  | Savings                 | Account balances and statement totals                                      |
| 11  | Contributions           | Separate view, account-specific forms and filtered history                 |
| 12  | Loans                   | Applications and loans with links to application/details/repayments        |
| 13  | Loan Application        | Separate validated amount/purpose/term/date form                           |
| 14  | Loan Details            | Selected loan principal, interest, status, dates and balance               |
| 15  | Repayments              | Separate recording forms, payment history and due dates                    |
| 16  | Transactions            | Search, type/status/date filters and verification entry                    |
| 17  | Blockchain Verification | Transaction/proof checks with loading and results                          |
| 18  | Meetings                | Agenda, location, organizers and meeting list                              |
| 19  | Attendance              | Separate attendance view with serialized writes and confirmation           |
| 20  | Notifications           | Unread markers and read actions with duplicate-tap protection              |
| 21  | Reports                 | Filtered analytics and summaries                                           |
| 22  | Settings                | Account/help for all users, authorized system-setting controls             |

## Shared requirements and repairs

- Responsive layout: centered maximum-width content, wrapping navigation, stacking cards/roles, scrollable onboarding.
- Consistent typography, spacing, palette, fields, buttons and cards; larger targets and controls that grow with text.
- Safe-area layout, iOS keyboard avoidance, named inputs, button roles/selected states and announced feedback.
- Phone-only registration, GHS labels, decimal keyboards, plain error messages, visible retry controls and bounded requests.
- Persistent navigation, explicit child-screen back links and Android hardware-back handling.
- Inline registration errors, positive amounts, password confirmation, real calendar dates/date ranges and loan purpose/term limits.
- Loading indicators, pending labels, cross-platform dismissible messages, empty states and write confirmations.
- Fixed hidden splash branding/text contrast, profile failure spinner, incomplete loan pagination, duplicate notification taps and overlapping attendance writes.
- Added permission-protected `GET /api/loans/:id` for selected-loan refresh, with owner/staff access tests.
- Fixed expired-session restoration, invalid refreshed-token logout, offline token retention and late responses after logout/account changes.
- Cleared cached account data and sensitive form values on logout/session expiry.
- Retained payment references after uncertain request failures; unchanged retries reuse the reference. Check history before changing payment details following an uncertain result.
- Separated contribution amount/description state by savings account.

## Automated checks

Verified results: 14 mobile regression tests passed, 26 authorization tests passed, and 6 loan-detail access tests passed. Mobile TypeScript and ESLint checks passed. The production web export passed with one worker (781 modules); the initial parallel export exhausted the machine's memory.

Follow-up automated acceptance completed: **5 scenarios passed**, with **25 automated accessibility audits** and **26 screen images**. The live-service scenario checked actual stored balances, duplicate-payment protection, private-loan access, reset delivery/single-use tokens, and genuine local blockchain proof verification. Two new blockchain receipt regression tests passed. API/mobile lint, mobile TypeScript, API build, and the updated production web export (783 modules) also passed. See `apps/mobile/acceptance-report/index.html` for the latest evidence.

From the repository root:

```powershell
npm.cmd test --workspace=@rcm/mobile
npm.cmd run typecheck --workspace=@rcm/mobile
npm.cmd run lint --workspace=@rcm/mobile
npm.cmd test --workspace=@rcm/api -- --runInBand --runTestsByPath src/authorization/loan-details.spec.ts src/auth/authorization.spec.ts
```

From `apps/mobile`:

```powershell
npx.cmd expo export --platform web --max-workers 1 --output-dir dist-review
```

Mobile tests cover registration/date validation, native/web token storage, expired saved sessions, failed refresh, offline recovery, API errors, empty responses, timeouts, late account data, concurrent refresh and late refresh after a new login.

## Physical checks outside the selected automated scope

1. Native-app behavior on a physical phone, including TalkBack/VoiceOver, operating-system text scaling, keyboard behavior and hardware back navigation.
2. Delivery through an actual SMS/email provider. The automated reset test uses a local HTTP delivery receiver.
3. Usability sessions with representative rural users. No participants were available, and the user selected automated checks only.

Status: **Module 21 automated acceptance completed successfully within the user-selected scope.** Physical device/screen-reader and participant checks are outside that scope. No next-module work was started.
