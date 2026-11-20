# Legacy analysis — HR, attendance, payroll, notifications, integrations

Status: reverse-engineered from `nuxt4-cms` source and read-only local MongoDB (`sen-tuan`, `bag-post`).

## 1. Scope and evidence

Legacy source:

- `nuxt4-cms/server/models/StaffProfile.ts`, `Attendance.ts`, `Payroll.ts`, `SalaryConfig.ts`
- `nuxt4-cms/server/models/Notification.ts`, `NotificationTask.ts`, `Connect.ts`, `Media.ts`
- `nuxt4-cms/server/api/v1/admin/hr/*`, `notifications/*`, `system/connects/*`

Local DB evidence:

- `sen-tuan`: `staff_profiles` 0, `attendances` 0, `payrolls` 0, `salary_configs` 0, `notifications` 0, `notification_tasks` 0, `connects` 2
- `bag-post`: all zero
- HR collections have no observed records; shape comes from source.

Target state: `HR-01`, `MSG-01`, `MSG-02`, `INT-01` are `Planned`/`Partial`.

## 2. Legacy behavior

### 2.1 HR

- StaffProfile: `userId` (unique), `positionCode` (director/manager/staff), `jobDescription`, `workStatus` (probation/official/resigned), soft delete, history.
- Attendance: `userId`, `date` (YYYY-MM-DD), `checkIn`, `checkOut`, `status` (present/late/leave), `warehouseId`; unique `(userId, date)`.
- SalaryConfig: `userId` (unique), `baseSalary`, `allowances[] { title, amount }`, `effectiveDate`, history.
- Payroll: `userId`, `month`, `year`, `totalWorkDays`, `calculatedSalary`, `status` (pending/paid); unique `(userId, month, year)`.

Defects:

- No shift model.
- No attendance/payroll write endpoints observed (mostly read-only).
- No salary→payroll calculation observed; `markPayrollAsPaid` exists but no endpoint calls it.
- Target must design period/state/approval logic and repeatable calculation.

### 2.2 Notifications

- Notification: `recipientId`, `taskId`, `isRead`, timestamps; index `(recipientId, isRead, createdAt)`.
- NotificationTask: model exists (not profiled here); likely task definitions.
- Legacy sends customer notifications on order transitions and payment failures.
- Target: recipient ownership, unsubscribe, idempotent send, retry/status, permission tests.

### 2.3 Mail and integrations

- Connect model stores provider connection: `key`, `provider`, `code`, `title`, `clientID`, `credentials` (object), `authUri`, `redirectUris`, `profile`, `config`, `isConnected`, `isActive`, history.
- **Security defect:** `Connect.credentials` can be stored as object in business collection; target must not store provider secrets plaintext in settings/Mongo. Use secret store/env and scoped config.
- Legacy default config contains committed credentials; treat as compromised and rotate before launch.
- Google OAuth/Gmail integration used for contact/newsletter and Google Drive/Sheets.
- Media uses Cloudinary.

### 2.4 Communications scope

- Inbox, notifications, mark-read, push/subscriptions/tasks.
- Mail templates, queue, deliveries/analytics, contact/newsletter.
- Provider integrations and settings.

## 3. Data dictionary (field coverage, `sen-tuan`)

- `staff_profiles`: 0
- `attendances`: 0
- `payrolls`: 0
- `salary_configs`: 0
- `notifications`: 0
- `notification_tasks`: 0
- `connects`: 2 (not profiled for values; only count)

No HR field coverage available. Connect count only.

## 4. Defects / unsafe legacy behavior not to port

1. HR mostly read-only; no write endpoints for attendance/payroll.
2. No shift model or salary→payroll calculation.
3. `Connect.credentials` stored as object in business collection; target must use secret store.
4. Legacy default config contains committed secrets; rotate before launch.
5. Contact email HTML interpolation of user input; target must sanitize.
6. Newsletter has no durable subscription/consent lifecycle.

## 5. Mapping to target

- Mongo collections (site-scoped): `staff_profiles`, `attendances`, `salary_configs`, `payrolls`, `notifications`, `notification_tasks`.
- Integrations: Hub connection registry or local provider registry/adapters; secrets in env/secret store, never in Mongo business collections.
- Web portal only through BFF/server-side commands.

## 6. Automated test scenarios

HR:

1. Attendance uniqueness per user/date.
2. Payroll uniqueness per user/month/year.
3. Salary calculation repeatable and auditable.
4. Compensation privacy and capability checks.

Notifications:

1. Recipient ownership; mark-read only own.
2. Idempotent send; retry/status.

Integrations:

1. No secret leakage in API responses or logs.
2. Connection config scoped by customer.
3. Provider failure handling.

## 7. Open questions

1. Is HR in first replacement scope or deferred?
2. Which notifications are required (order transitions, payment failures, etc.)?
3. Which integrations must be supported (email, push, shipping, Google, Cloudinary)?
4. Provider selection for email/push/media.
