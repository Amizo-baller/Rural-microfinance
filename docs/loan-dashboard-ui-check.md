# Loan dashboard visual update

The My Loans screen follows the supplied repayment dashboard: a centered title and back arrow, a white loan overview with a status pill, a mint details panel, a green Repay loan button, an outlined Apply for a loan button, a repayment progress card, and fixed Home / Savings / Loans / Activity navigation with Loans selected. Existing loan details, repayment history, application history, additional loans, refresh, and pagination remain accessible below the overview.

All amounts on this overview use SLE formatting. Stored values, currency fields, API requests, repayment validation, idempotency references, application rules, and permissions are unchanged. Repay loan opens the existing repayment form; Apply for a loan opens the existing application form. Other loan forms retain their existing currency labels.

The overview shows the first loaded active loan, or the first loaded loan when none is active. It uses the actual principal, outstanding balance, start date, term, and status. The progress display sums confirmed repayments for that loan reference and compares that paid amount with paid plus remaining balance. This calculation is for presentation only.

The existing API has no installment schedule or next-payment amount. The next-payment section therefore shows Not scheduled and labels the actual final due date separately. The image's sample amounts and dates are not used as application data.

## Phone check

1. Reload Expo Go and sign in with an existing account.
2. Open Loans or Pay loan from Home. Confirm My Loans, the mint loan details, and the fixed navigation bar.
3. Check the displayed amounts, loan term, dates, and status against the existing account data.
4. Tap Repay loan to open the existing form. Check the amount limit and existing validation before recording a test repayment in your test account.
5. Return Home and reopen Loans. Verify the updated balance, amount paid, and progress.
6. Check Apply for a loan, View loan details, View repayments, bottom navigation, and pull-to-refresh.
7. Verify an account without loans shows an empty state, and accounts without financial write permission have no repayment or application button.

## Automated check

```powershell
npm.cmd run typecheck --workspace=@rcm/mobile
npm.cmd run lint --workspace=@rcm/mobile
npm.cmd run build:review --workspace=@rcm/mobile
npm.cmd run test:acceptance --workspace=@rcm/mobile -- dashboard.spec.cjs loan-dashboard.spec.cjs
```

The loan test creates a separate account and loan in the isolated acceptance database, records a real repayment, checks the displayed values against the API, audits accessibility and narrow-screen overflow, and opens the existing application form. Screenshots are written to apps/mobile/acceptance-results.

## Verification completed (2026-10-08)

TypeScript, mobile lint, and the final web build passed. The three existing dashboard acceptance tests passed during regression verification. The loan acceptance test passed against the final build, including real repayments changing the outstanding balance from 1,200 to 1,100, the paid amount from 800 to 900, and progress from 40% to 45%. Accessibility passed, and a 320px layout with text enlarged to 150% had no horizontal overflow. The final reference screenshot was visually reviewed. Physical-phone confirmation remains pending.
