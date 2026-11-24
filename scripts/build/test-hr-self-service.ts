import assert from 'node:assert/strict'
import { HrServiceError, createStaff, getStaffBySubject } from '../../tm-cms/server/services/staffService.js'
import { upsertAttendance } from '../../tm-cms/server/services/attendanceService.js'
import { setSalaryConfig, calculatePayroll, getOwnPayroll, listPayrolls } from '../../tm-cms/server/services/payrollService.js'
import { assignShift, createShiftTemplate, listShiftAssignments } from '../../tm-cms/server/services/shiftService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
import { CUSTOMER_DAY_MS, localDayOf, localDayStartUtc, todayInCustomerTime } from '../../tm-cms/server/utils/customerTime.js'
import { prepareDatabase } from '../../tm-cms/server/utils/modelRegistry.js'

let checks = 0
let notRun = 0

async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    checks++
    console.log(`   ✅ ${name}`)
  } catch (error) {
    console.error(`   ❌ ${name}`)
    console.error(`      ${(error as Error).message}`)
    process.exitCode = 1
  }
}

const SITE = 'sentuan'
const ACTOR = { id: 'user_mock_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('HR self-service — own attendance and payroll\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_hr_self_service' }

// Shifts may only be assigned for today or later, so the fixture follows the
// clock instead of a fixed date that goes stale the next day.
const SHIFT_DATE = todayInCustomerTime(new Date())
const NEXT_SHIFT_DATE = localDayOf(new Date(localDayStartUtc(SHIFT_DATE).getTime() + CUSTOMER_DAY_MS))

async function run() {
  let connection
  try {
    connection = await connectDatabase(binding)
  } catch {
    notRun++
    console.log(`   ⚠️  NOT RUN — no MongoDB reachable at ${URI}`)
    return
  }

  try {
    await connection.db!.dropDatabase()
    const models = await prepareDatabase(connection)
    const { StaffProfile, Attendance, SalaryConfig, Payroll, Audit, ShiftTemplate, ShiftAssignment } = models
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const staff = await createStaff(StaffProfile, SITE, {
      subjectId: ACTOR.id,
      employeeCode: 'E001',
      fullName: 'An Nguyen',
      positionCode: 'staff',
      workStatus: 'official',
    }, meta)

    await check('a profile can be found by Hub subject', async () => {
      const found = await getStaffBySubject(StaffProfile, SITE, ACTOR.id)
      assert.equal(found?.id, staff.id)
      assert.equal(found?.employeeCode, 'E001')
    })

    await upsertAttendance(Attendance, StaffProfile, SITE, {
      staffId: staff.id,
      date: '2026-11-03',
      status: 'present',
    }, meta)

    await check('attendance filters to the signed-in staff', async () => {
      const result = await (await import('../../tm-cms/server/services/attendanceService.js')).listAttendances(Attendance, SITE, { staffId: staff.id, month: '2026-11' })
      assert.equal(result.data.length, 1)
      assert.equal(result.data[0]!.status, 'present')
    })

    await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
      staffId: staff.id,
      baseSalary: 3000000,
      allowances: [{ title: 'Lunch', amount: 200000 }],
      standardWorkDays: 22,
      effectiveFrom: '2026-11-01',
    }, meta)

    await calculatePayroll(Payroll, { attendanceModel: Attendance, salaryModel: SalaryConfig, staffModel: StaffProfile, siteId: SITE }, SITE, {
      period: '2026-11',
      staffId: staff.id,
    }, meta)

    await check('payroll filters to the signed-in staff', async () => {
      const result = await listPayrolls(Payroll, SITE, { staffId: staff.id, period: '2026-11' })
      assert.equal(result.data.length, 1)
      assert.equal(result.data[0]!.period, '2026-11')
    })

    const template = await createShiftTemplate(ShiftTemplate, SITE, {
      code: 'MORNING',
      name: 'Morning',
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
    }, meta)

    await assignShift({ ShiftTemplate, ShiftAssignment, StaffProfile }, SITE, {
      staffId: staff.id,
      templateId: template.template.id,
      date: SHIFT_DATE,
    }, {}, meta)

    const colleague = await createStaff(StaffProfile, SITE, {
      subjectId: 'user_other',
      employeeCode: 'E002',
      fullName: 'Binh Tran',
      positionCode: 'staff',
      workStatus: 'official',
    }, meta)

    await assignShift({ ShiftTemplate, ShiftAssignment, StaffProfile }, SITE, {
      staffId: colleague.id,
      templateId: template.template.id,
      date: NEXT_SHIFT_DATE,
    }, {}, meta)

    await check('the roster lists only the signed-in staff member shifts', async () => {
      const roster = await listShiftAssignments(
        { ShiftAssignment, StaffProfile },
        SITE,
        { staffId: staff.id, from: SHIFT_DATE, to: NEXT_SHIFT_DATE },
      )
      assert.equal(roster.data.length, 1)
      assert.equal(roster.data[0]!.staffId, staff.id)
      assert.equal(roster.data[0]!.shiftCode, 'MORNING')
      assert.equal(roster.summary.workedMinutes, 480)
    })

    await check('a colleague reads their own shift, not the first staff member\'s', async () => {
      const roster = await listShiftAssignments(
        { ShiftAssignment, StaffProfile },
        SITE,
        { staffId: colleague.id, from: SHIFT_DATE, to: NEXT_SHIFT_DATE },
      )
      assert.equal(roster.data.length, 1)
      assert.equal(roster.data[0]!.staffId, colleague.id)
      assert.equal(roster.data[0]!.date, NEXT_SHIFT_DATE)
    })

    await check('a payslip reads only the signed-in member\'s own row', async () => {
      const own = await listPayrolls(Payroll, SITE, { staffId: staff.id, period: '2026-11' })
      const ownId = own.data[0]!.id

      const mine = await getOwnPayroll(Payroll, StaffProfile, SITE, ACTOR.id, ownId)
      assert.equal(mine.payroll.id, ownId)
      assert.equal(mine.staff.id, staff.id)
      assert.equal(mine.payroll.employeeCode, 'E001')

      // A colleague's row really exists, so the refusal below is about ownership.
      await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
        staffId: colleague.id,
        baseSalary: 2000000,
        standardWorkDays: 22,
        effectiveFrom: '2026-11-01',
      }, meta)
      const colleaguePayroll = await calculatePayroll(
        Payroll,
        { attendanceModel: Attendance, salaryModel: SalaryConfig, staffModel: StaffProfile, siteId: SITE },
        SITE,
        { period: '2026-11', staffId: colleague.id },
        meta,
      )
      const colleagueId = colleaguePayroll.lines[0]!.payrollId!

      const isHrError = (status: number, code: string) =>
        (error: unknown) => error instanceof HrServiceError && error.statusCode === status && error.code === code

      await assert.rejects(
        () => getOwnPayroll(Payroll, StaffProfile, SITE, ACTOR.id, colleagueId),
        isHrError(404, 'PAYROLL_NOT_FOUND'),
      )
      await assert.rejects(
        () => getOwnPayroll(Payroll, StaffProfile, SITE, 'user_without_profile', ownId),
        isHrError(404, 'STAFF_NOT_FOUND'),
      )
    })

    await check('an unknown subject has no profile', async () => {
      const found = await getStaffBySubject(StaffProfile, SITE, 'user_unknown')
      assert.equal(found, null)
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} HR self-service checks: ${checks} passed, ${notRun} not run\n`)
