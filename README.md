# Rural Community Microfinance Management System

Mobile-first microfinance management system with a NestJS API, Expo application, PostgreSQL/Prisma data layer, and Solidity/Hardhat blockchain workspace.

For terminal commands, the Expo address on port 8081, and MetaMask Mobile configuration, use [Terminals and MetaMask Mobile](README-TERMINALS-METAMASK-MOBILE.md).

## Modules 1–5: current implementation

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev:api
npm.cmd run dev:mobile
npm.cmd run chain
```

In separate terminals, validate the foundation with:

```powershell
npm.cmd run prisma:generate --workspace=@rcm/api
npm.cmd run compile --workspace=@rcm/contracts
```

The API health check is `http://localhost:3000/api/health`. A PostgreSQL instance matching `DATABASE_URL` is required for database-backed features; the health endpoint stays available when it is offline.

For the local Hardhat node, Sepolia deployment, backend configuration, and proof checks, follow [Blockchain setup](docs/blockchain-setup.md). Start the node with `npm.cmd run chain`, then run `npm.cmd run chain:setup:local` in another terminal.

### Module coverage

- **Module 1:** monorepo foundation, NestJS API, Expo mobile app, PostgreSQL/Prisma wiring, and a Solidity deployment registry.
- **Module 2:** normalized database schema and migrations for users, groups, savings, contributions, loans, repayments, transactions, meetings, notifications, audit logs, and blockchain records.
- **Module 3:** registration, login, access/refresh tokens, logout, password reset, profile identity lookup, and request validation.
- **Module 4:** role/permission guards, system settings, administrator-role assignment, and mobile self-service profile editing.
- **Module 5:** secured user management: create users, list/search/filter users, view profiles, update profiles, deactivate accounts, reactivate accounts, and soft-delete accounts while retaining financial and audit history.
- **Module 6:** community-group management with group administrators, contact and location details, search/filtering, deactivation, and a group dashboard with live member, savings, loan, application, and meeting statistics.
- **Module 7:** member management, group assignment, generated member numbers, profiles with savings and loan balances, search/filtering, and membership-status management.
- **Module 8:** savings accounts, atomic/idempotent contributions, balances, contribution search and date filters, statements, and mobile savings management.

### Module 5 user-management API

All user-management routes require an authenticated bearer token and are prefixed with `/api`.

| Requirement     | Endpoint                                               | Access                                    |
| --------------- | ------------------------------------------------------ | ----------------------------------------- |
| Create user     | `POST /users`                                          | `ADMIN`, `SUPER_ADMIN`                    |
| View users      | `GET /users?search=&status=&role=&page=&limit=`        | `ADMIN`, `SUPER_ADMIN`                    |
| View one user   | `GET /users/:id`                                       | The user themself, `ADMIN`, `SUPER_ADMIN` |
| Update user     | `PATCH /users/:id`                                     | The user themself, `ADMIN`, `SUPER_ADMIN` |
| Deactivate user | `PATCH /users/:id/status` with `{"status":"INACTIVE"}` | `ADMIN`, `SUPER_ADMIN`                    |
| Reactivate user | `PATCH /users/:id/status` with `{"status":"ACTIVE"}`   | `ADMIN`, `SUPER_ADMIN`                    |

When an account is deactivated, its refresh sessions are revoked and its existing access token is rejected immediately. Only a `SUPER_ADMIN` can soft-delete a user, and no user can deactivate or delete their own account.

### Module 6 community-group API

All group routes require an authenticated bearer token and are prefixed with `/api`. `ADMIN` and `SUPER_ADMIN` can manage every group; a `GROUP_MANAGER` can create a group assigned to themself and manage only their assigned group. Members can view groups.

| Requirement                 | Endpoint                                             | Notes                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create group                | `POST /groups`                                       | Requires `name`, `registrationNo`, `location`, `contactInfo`, and `managerId`; `description` is optional. Creation date and active status are set automatically. |
| View/search/filter groups   | `GET /groups?search=&location=&status=&page=&limit=` | Searches name, registration number, and location; supports status/location filters and pagination.                                                               |
| View group dashboard        | `GET /groups/:id`                                    | Includes all group details plus member, savings, loan, application, and meeting statistics.                                                                      |
| Update group                | `PATCH /groups/:id`                                  | Updates the group details. Changing `managerId` is restricted to platform administrators.                                                                        |
| Deactivate or change status | `PATCH /groups/:id/status`                           | Send `{"status":"INACTIVE"}` to deactivate; supported statuses are `ACTIVE`, `INACTIVE`, `SUSPENDED`, and `ARCHIVED`.                                            |

The Expo mobile app exposes an active-groups list and a group-details screen with the group dashboard statistics.

### Module 7 member-management API

All member routes require an authenticated bearer token and are prefixed with `/api`. A member belongs to exactly one community group; this rule is enforced by a unique database constraint. Administrators can manage all members, while a `GROUP_MANAGER` is restricted to members in the group they administer.

| Requirement                  | Endpoint                                             | Notes                                                                                                                          |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Add and assign member        | `POST /members`                                      | Requires an active `MEMBER` user and active `groupId`; generates a group-scoped `MBR-000001` style number.                     |
| View/search/filter members   | `GET /members?search=&groupId=&status=&page=&limit=` | Searches names, contact information, and member number.                                                                        |
| View member profile          | `GET /members/:id`                                   | Includes full name, contact details, group, membership date/status, total active savings, and outstanding active-loan balance. |
| Update member details        | `PATCH /members/:id`                                 | Updates the member's name and contact information.                                                                             |
| Deactivate/change membership | `PATCH /members/:id/status`                          | Supports `ACTIVE`, `INACTIVE`, `SUSPENDED`, and `EXITED`.                                                                      |

### Module 8 savings-management API

All savings routes are prefixed with `/api`. Every contribution is recorded in a serializable database transaction that creates the contribution record and immutable financial transaction while incrementing the account balance. A unique reference is required, so retries cannot create duplicate financial records.

| Requirement                 | Endpoint                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Savings dashboard           | `GET /savings/dashboard`                                                                             |
| Create account              | `POST /savings/accounts` with `groupMemberId`                                                        |
| View balance                | `GET /savings/accounts/:id`                                                                          |
| Record contribution/deposit | `POST /savings/contributions` with account, amount, reference, payment method, date, and description |
| Contribution search/history | `GET /savings/contributions?search=&groupId=&groupMemberId=&savingsAccountId=&from=&to=`             |
| Savings statement           | `GET /savings/accounts/:id/statement?from=&to=`                                                      |
| Account status              | `PATCH /savings/accounts/:id/status`                                                                 |

### Database setup and verification

```powershell
Copy-Item .env.example .env
npm.cmd run prisma:generate --workspace=@rcm/api
npm.cmd run prisma:migrate --workspace=@rcm/api
npm.cmd run prisma:seed --workspace=@rcm/api
npm.cmd test --workspace=@rcm/api -- --runInBand
```

`POST /api/auth/forgot-password` returns a reset token only in development. In production, configure `PASSWORD_RESET_WEBHOOK_URL` to an email/SMS delivery integration. The API sends it a JSON payload with `type`, the intended `recipient`, and a one-time `resetUrl`; it rejects a reset request if delivery is not configured or the provider fails.

## Structure

### Module 22: mobile/backend integration

The mobile application uses a shared API client with stored/refreshable sessions, actual backend data, server validation feedback, request timeouts, paginated lists and refresh/logout flows. The API mapping, configuration and verification commands are documented in [Module 22 integration](docs/module-22-integration.md).

- `apps/api` — NestJS, validation, exception handling, logging, Prisma
- `apps/mobile` — Expo + Expo Router and API environment hook
- `packages/contracts` — Hardhat, Solidity compiler, local deployment script

Modules after Module 5 can build on these authenticated, role-protected foundations.
