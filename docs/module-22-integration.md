# Module 22 — mobile/backend integration

The mobile runtime uses the actual configured API. It contains no mock service, sample account, fallback financial record or simulated API response. Test data is created in an isolated PostgreSQL database by the acceptance harness and is not imported into the app bundle.

## Runtime integration

- `apps/mobile/src/api-client.ts` handles JSON requests, bearer authentication, nested server validation errors, connection/body timeouts, 204 responses, expired-session refresh, and session changes while requests are pending.
- Native credentials use Expo SecureStore. Web credentials use sessionStorage. Access/refresh tokens are kept in one session record to prevent mixed token pairs; older installations migrate their legacy keys automatically.
- Concurrent unauthorized requests share a refresh; a later unauthorized response can reuse an already renewed token. Forbidden role responses retain the session. Failed refresh clears local credentials and returns to sign-in. Offline refresh keeps credentials for a later retry.
- Logout clears local credentials and account data immediately, then requests server-side refresh-token revocation. Offline logout still clears the local session; remote revocation requires a connection.
- API configuration supports a hosted HTTP(S) API, a web reverse-proxy path such as `/api`, Android emulator networking, and the desktop LAN address supplied by Expo for a physical device. Embedded credentials and invalid protocols are rejected.
- Resource request tickets prevent an older search/filter response from replacing a newer result. Logout invalidates pending screen commits.
- List responses require actual `items`, `page`, `limit`, and `total` metadata. Appended pages merge by record ID. Loan-application and created-loan totals are tracked separately, including repayment pagination.
- Staff group lists and profile views fetch on entry. Personal settings load the authenticated user's account; administrator settings also load system settings.
- Unavailable summaries are shown as unavailable, rather than fabricated zero balances or record counts.
- Profile forms wait for the account fetch before accepting edits; saves invalidate older reads so background responses cannot silently replace the submitted values.

## Screen/API mapping

All routes below use the `/api` prefix. Protected requests attach the current stored bearer token; access is enforced by backend permissions and record ownership.

| Screen                  | Actual integration                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Splash                  | Stored-session lookup; `GET /auth/me`, refresh when needed; startup/session loading                                |
| Onboarding              | Local explanatory UI; session restoration decides whether it is shown; no business records                         |
| Login                   | `POST /auth/login`, validated token storage, permissions/account loading                                           |
| Registration            | `POST /auth/register`, client and server validation, returned session                                              |
| Forgot password         | `POST /auth/forgot-password`; delivered link uses `POST /auth/reset-password`                                      |
| Dashboard               | `GET /auth/permissions`; member savings/group/application/notification summaries or `GET /admin/dashboard`         |
| Profile                 | `GET /users/:id`, `PATCH /users/:id`                                                                               |
| Group                   | `GET /groups?page=&limit=`, `GET /groups/:id`                                                                      |
| Members                 | `GET /members?search=&groupId=&page=&limit=`, `GET /members/:id`                                                   |
| Savings                 | `GET /savings/dashboard`, `GET /savings/accounts/:id/statement`                                                    |
| Contributions           | `GET /savings/contributions` with filters/pagination; `POST /savings/contributions`                                |
| Loans                   | `GET /loans/applications`, `GET /loans`, independent server totals                                                 |
| Loan application        | `POST /loans/applications`; server approval/disbursement reflected by reload/refresh                               |
| Loan details            | Actual list record and `GET /loans/:id` for refresh                                                                |
| Repayments              | `GET /loans/:id/repayments`, `POST /loans/:id/repayments`; created-loan pagination                                 |
| Transactions            | `GET /financial-records` with search/type/status/date filters and pagination                                       |
| Blockchain verification | `GET /blockchain/status` when permitted, `GET /blockchain/verify/:id`, `POST /blockchain/proofs/:reference/verify` |
| Meetings                | `GET /meetings?page=&limit=`                                                                                       |
| Attendance              | `GET /meetings/:id/attendance`, `POST /meetings/:id/attendance`                                                    |
| Notifications           | `GET /notifications?page=&limit=`, `PATCH /notifications/:id/read`, `POST /notifications/read-all`                 |
| Reports                 | `GET /reports/analytics` with selected filters                                                                     |
| Settings                | `GET /users/:id`; authorized `GET /system/settings`, `PATCH /system/settings/:key`                                 |

## Configuration and verification

Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to the real API address ending in `/api`. A hosted production API needs an explicit reachable URL or a configured same-origin web proxy. Development localhost addresses are resolved against the Expo host for native devices and the browser host for LAN previews.

From the repository root:

```powershell
npm.cmd run typecheck --workspace=@rcm/mobile
npm.cmd run lint --workspace=@rcm/mobile
npm.cmd test --workspace=@rcm/mobile
npm.cmd run build --workspace=@rcm/api
npm.cmd run build:review --workspace=@rcm/mobile
npm.cmd run test:acceptance --workspace=@rcm/mobile
```

The acceptance suite uses genuine NestJS, PostgreSQL and local blockchain services. The browser forwards API requests to the isolated backend rather than inventing responses. Integration-specific checks cover genuine signed expired tokens, refresh rotation, reload restoration, invalid refresh credentials, online/offline logout, server validation, delayed actual search requests, staff screen-entry loading, pagination and refresh.

Verification completed: **9 live acceptance scenarios passed**, including the full screen workflow and the four Module 22 integration scenarios. **24 mobile regression tests passed**, along with TypeScript, lint and the updated production web export. There are **26 automated accessibility audits** and **27 screen captures**, including member details. See `apps/mobile/acceptance-report/index.html` for the generated evidence.

The app/runtime source search found no mock, fixture, sample-account, fake-data or demo-response implementation. Authentication and business data always come from the configured API. Onboarding instructions and help text are local presentation content, not simulated records.
