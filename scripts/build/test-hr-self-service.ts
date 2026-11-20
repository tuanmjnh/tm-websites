import assert from 'node:assert/strict'
import { createStaff, getStaffBySubject } from '../../tm-cms/server/services/staffService.js'
import { upsertAttendance } from '../../tm-cms/server/services/attendanceService.js'
import { setSalaryConfig, calculatePayroll, listPayrolls } from '../../tm-cms/server/services/payrollService.js'
import { closeDatabaseConnections, connectDatabase } from '../../tm-cms/server/utils/database.js'
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
    const { StaffProfile, Attendance, SalaryConfig, Payroll, Audit } = models
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
