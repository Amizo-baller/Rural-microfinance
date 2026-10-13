# Dashboard visual update

The mobile dashboard uses the supplied savings overview as its visual reference: a green savings card, mint action and community cards, recent activity, and a fixed Home / Savings / Loans / Activity bar. The header shows the signed-in account role and a time-appropriate greeting. Notifications open from the bell. Additional existing services, logout, and admin reports remain accessible further down the screen.

All dashboard amounts display `SLE` with two decimal places and thousands separators. This is a presentation change; API requests, stored financial values, validation, permissions, authentication, and calculations are unchanged. Other screens retain their existing currency display.

The dashboard uses real loaded savings, contributions, repayments, groups, and notifications. Administrator totals and activity come from the existing admin dashboard response. It does not copy the example balance, group name, member count, or blockchain sync claim. A member count is displayed only when the matching group's actual details are available. Blockchain verification remains an existing action and shows a verified state only for an actual verified result.

At the user's request, dashboard labels for `Module 6 Validation Group` (including its generated numeric suffix) display **Sierra Leone Mile 91 MicroFinance Group** in bold. This is a display alias; the group record, identifier, navigation, balances, and API responses remain unchanged. Other group names retain their loaded labels.

Accounts with the existing `members:manage` permission see an **Add member** dashboard button. Administrators can search active registered member accounts, select an active community group, and confirm the addition through the existing `POST /members` endpoint. This assigns an existing account; it does not register a new account. Existing role, group-access, and duplicate-membership rules remain enforced by the backend. Successful additions open the saved member's details. Group managers retain their existing permissions and can enter a registered account ID without access to the administrator's user directory.

## Phone test

1. Keep the API running and the phone connected to the computer's Wi-Fi. If the network address changed, update the development API address and its scoped firewall rule before testing.
2. From the repository root, start Expo with `npm.cmd run start:tunnel --workspace=@rcm/mobile`. If Expo is already running, reload the app from the Expo Go developer menu.
3. Scan the current Expo QR with Expo Go and sign in with your existing account.
4. Confirm the title reads **My Dashboard**, the balance begins with **SLE**, the three action cards appear, and the bottom bar stays visible while scrolling.
5. Compare the numeric savings total with your account's existing balance. The UI must not use the reference image's example amount.
6. Tap **Save**, **Pay loan**, **History**, the notification bell, and the community card. They should open the existing corresponding screens. Return Home after each check.
7. Pull down to refresh. The dashboard should reload real data and retain the design. Scroll down to check Profile, other services, and Logout.
8. With an admin account, confirm the same dashboard shell and the existing admin totals, charts, and review information below the activity card.
9. With an administrator account, tap **Add member**, search for an active registered member account that has not joined a group, select a group, and tap **Confirm add member**. Confirm that the saved member details show a generated member number. An account already assigned to a group must be rejected. Ordinary member accounts must not see the Add member button.

## Automated checks

```powershell
npm.cmd run typecheck --workspace=@rcm/mobile
npm.cmd run lint --workspace=@rcm/mobile
npm.cmd test --workspace=@rcm/mobile
npm.cmd run build:review --workspace=@rcm/mobile
npm.cmd run test:acceptance --workspace=@rcm/mobile
```

The browser acceptance suite uses an isolated database and real backend services. Dashboard checks include SLE output, the new actions, real community data, accessibility, and narrow-screen layouts. Acceptance screenshots are written to `apps/mobile/acceptance-results`.

## Validation completed (2026-10-08)

TypeScript, mobile lint, all 25 mobile unit tests, and the web review build passed. Both dashboard browser acceptance tests passed: the member dashboard matched the backend savings balance and retained navigation and refresh; the administrator dashboard passed accessibility and overflow checks at 320px width with text enlarged to 150%. The member screenshot was also visually reviewed.

The dashboard acceptance helper now allows 60 seconds for the backend summary response, matching its existing dashboard loading checks. Earlier attempts encountered a transient database connection failure and a 15-second response-wait timeout; the final run passed both tests. Physical-phone confirmation of this dashboard remains pending.

After the group-label and Add member update, TypeScript and lint passed again and all three dashboard browser tests passed. The additional test confirmed the bold replacement label, a successful member assignment persisted by the existing API, unchanged stored group names, and no Add member button for an ordinary member account. All test writes used the isolated acceptance database.
