import assert from 'node:assert/strict'
import {
  HrServiceError,
  createStaff,
  getStaff,
  listStaff,
  restoreStaff,
  softDeleteStaff,
  updateStaff,
} from '../../tm-cms/server/services/staffService.js'
import {
  attendanceToCsv,
  deleteAttendance,
  exportAttendancesCsv,
  listAttendances,
  upsertAttendance,
} from '../../tm-cms/server/services/attendanceService.js'
import {
  approvePayroll,
  calculatePayroll,
  cancelPayroll,
  exportPayrollsCsv,
  getPayroll,
  listPayrolls,
  listSalaryConfigs,
  payPayroll,
  payrollToCsv,
  setSalaryConfig,
} from '../../tm-cms/server/services/payrollService.js'
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

function isHrError(status: number, code: string) {
  return (error: unknown) => error instanceof HrServiceError && error.statusCode === status && error.code === code
}

const SITE = 'sentuan'
const OTHER_SITE = 'bagpost'
const ACTOR = { id: 'user_test_admin', name: 'Test Admin', email: 'admin@example.com' }

console.log('HR — staff directory, attendance and a payroll that can explain itself (live MongoDB)\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = { uri: URI, database: 'tm_test_hr_service' }

async function integration() {
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
    const { StaffProfile, Attendance, SalaryConfig, Payroll, Audit } = await prepareDatabase(connection)
    const meta = { audit: { model: Audit, actor: ACTOR } }

    const an = await createStaff(StaffProfile, SITE, {
      subjectId: 'hub:user:an',
      employeeCode: 'nv-001',
      fullName: 'Nguyễn Văn An',
      positionCode: 'staff',
      workStatus: 'official',
      joinedAt: '2025-03-01',
      phone: '0900000001',
    }, meta)

    await check('a staff profile keeps employment facts and no compensation', async () => {
      assert.equal(an.employeeCode, 'NV-001', 'codes are stored upper-case')
      assert.equal(an.workStatus, 'official')
      assert.equal(an.revision, 1)
      assert.ok(!('baseSalary' in an))

      const listed = await listStaff(StaffProfile, SITE)
      assert.equal(listed.data.length, 1)
      assert.deepEqual(listed.counts, { all: 1, probation: 0, official: 1, resigned: 0 })
      assert.ok(!('baseSalary' in listed.data[0]!), 'a staff list cannot leak pay')
    })

    await check('a duplicate employee code or Hub subject is refused', async () => {
      await assert.rejects(
        () => createStaff(StaffProfile, SITE, {
          subjectId: 'hub:user:other',
          employeeCode: 'NV-001',
          fullName: 'Trùng mã',
        }, meta),
        isHrError(409, 'STAFF_EXISTS'),
      )
      await assert.rejects(
        () => createStaff(StaffProfile, SITE, {
          subjectId: 'hub:user:an',
          employeeCode: 'NV-999',
          fullName: 'Trùng tài khoản',
        }, meta),
        isHrError(409, 'STAFF_EXISTS'),
      )
    })

    await check('an update needs the current revision and cannot move the Hub subject', async () => {
      const updated = await updateStaff(StaffProfile, SITE, an.id, {
        revision: 1,
        fullName: 'Nguyễn Văn An (đã sửa)',
        subjectId: 'hub:user:hijack',
      }, meta)
      assert.equal(updated.revision, 2)
      assert.equal(updated.fullName, 'Nguyễn Văn An (đã sửa)')
      assert.equal(updated.subjectId, 'hub:user:an', 'identity belongs to Hub, not to this payload')

      await assert.rejects(
        () => updateStaff(StaffProfile, SITE, an.id, { revision: 1, fullName: 'Cũ' }, meta),
        isHrError(409, 'STAFF_REVISION_CONFLICT'),
      )
    })

    const binh = await createStaff(StaffProfile, SITE, {
      subjectId: 'hub:user:binh',
      employeeCode: 'NV-002',
      fullName: 'Trần Thị Bình',
      workStatus: 'probation',
    }, meta)

    await check('staff are hidden and restored without losing history', async () => {
      const removed = await softDeleteStaff(StaffProfile, SITE, binh.id, binh.revision, meta)
      assert.equal(removed.isDeleted, true)
      assert.equal((await listStaff(StaffProfile, SITE)).data.length, 1)
      assert.equal((await listStaff(StaffProfile, SITE, { includeDeleted: true })).data.length, 2)
      await assert.rejects(() => getStaff(StaffProfile, SITE, binh.id).then(row => {
        if (row.isDeleted) throw new HrServiceError(409, 'STAFF_DELETED', 'deleted')
      }), isHrError(409, 'STAFF_DELETED'))

      const restored = await restoreStaff(StaffProfile, SITE, binh.id, removed.revision, meta)
      assert.equal(restored.isDeleted, false)
      assert.equal((await listStaff(StaffProfile, SITE)).data.length, 2)
    })

    await check('attendance is one row per person per day, and re-posting corrects it', async () => {
      const first = await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: '2026-10-01',
        status: 'present',
        checkIn: '08:00',
        checkOut: '17:30',
      }, meta)
      assert.equal(first.created, true)

      const corrected = await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: '2026-10-01',
        status: 'late',
        checkIn: '08:35',
        checkOut: '17:30',
        note: 'Kẹt xe',
      }, meta)
      assert.equal(corrected.created, false)
      assert.equal(corrected.attendance.id, first.attendance.id)
      assert.equal(await Attendance.countDocuments({ siteId: SITE }), 1)
      assert.equal(corrected.attendance.status, 'late')
    })

    await check('an impossible day or a contradictory time is refused', async () => {
      await assert.rejects(
        () => upsertAttendance(Attendance, StaffProfile, SITE, { staffId: an.id, date: '2026-02-31', status: 'present' }, meta),
        isHrError(422, 'ATTENDANCE_DATE_INVALID'),
      )
      await assert.rejects(
        () => upsertAttendance(Attendance, StaffProfile, SITE, {
          staffId: an.id,
          date: '2026-10-02',
          status: 'present',
          checkIn: '17:00',
          checkOut: '08:00',
        }, meta),
        isHrError(422, 'ATTENDANCE_TIME_INVALID'),
      )
      await assert.rejects(
        () => upsertAttendance(Attendance, StaffProfile, SITE, {
          staffId: an.id,
          date: '2026-10-03',
          status: 'leave',
          checkIn: '08:00',
        }, meta),
        isHrError(422, 'ATTENDANCE_TIMES_NOT_ALLOWED'),
      )
    })

    await check('a wrong day is deleted, not hidden, so payroll cannot count it', async () => {
      const wrong = await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: binh.id,
        date: '2026-10-04',
        status: 'present',
      }, meta)
      await deleteAttendance(Attendance, SITE, wrong.attendance.id, meta)
      assert.equal(await Attendance.countDocuments({ siteId: SITE, date: '2026-10-04' }), 0)
      await assert.rejects(() => deleteAttendance(Attendance, SITE, wrong.attendance.id, meta), isHrError(404, 'ATTENDANCE_NOT_FOUND'))
    })

    await check('attendance pages by cursor while the summary counts the whole month', async () => {
      for (const day of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
        await upsertAttendance(Attendance, StaffProfile, SITE, { staffId: an.id, date: day, status: 'present' }, meta)
      }

      const first = await listAttendances(Attendance, SITE, { month: '2026-10', limit: 2 })
      assert.equal(first.data.length, 2)
      assert.equal(first.hasMore, true)
      assert.equal(first.data[0]!.date, '2026-10-13')
      assert.equal(first.summary.all, 5)
      assert.equal(first.summary.present, 4)
      assert.equal(first.summary.late, 1)

      const second = await listAttendances(Attendance, SITE, { month: '2026-10', limit: 2, cursor: first.nextCursor })
      assert.equal(second.data.length, 2)
      assert.equal(second.hasMore, true)
      assert.equal(second.data[0]!.date, '2026-10-11')
      assert.equal(second.summary.all, 5)

      const third = await listAttendances(Attendance, SITE, { month: '2026-10', limit: 2, cursor: second.nextCursor })
      assert.equal(third.data.length, 1)
      assert.equal(third.hasMore, false)
      assert.equal(third.nextCursor, null)
      assert.equal(third.data[0]!.date, '2026-10-01')

      const seen = [...first.data, ...second.data, ...third.data].map(row => row.id)
      assert.equal(new Set(seen).size, 5)

      await assert.rejects(
        () => listAttendances(Attendance, SITE, { month: '2026-10', cursor: 'nonsense' }),
        isHrError(422, 'ATTENDANCE_CURSOR_INVALID'),
      )
    })

    await check('the attendance export answers the filter, with staff code and name', async () => {
      const exported = await exportAttendancesCsv(Attendance, StaffProfile, SITE, { month: '2026-10' })
      const lines = exported.csv.trimEnd().split('\n')
      assert.equal(exported.rows, 5)
      assert.equal(exported.truncated, false)
      assert.equal(lines[0], '# Chấm công 2026-10 (5 dòng)')
      assert.equal(lines[1], 'Ngày,Mã nhân sự,Họ tên,Trạng thái,Giờ vào,Giờ ra,Kho,Ghi chú')
      assert.equal(lines.length, 7, 'a comment line, a header line and one line per row')
      assert.ok(lines.includes('2026-10-01,NV-001,Nguyễn Văn An (đã sửa),Trễ,08:35,17:30,,Kẹt xe'), `the staff code and name travel with the row\n${exported.csv}`)

      const late = await exportAttendancesCsv(Attendance, StaffProfile, SITE, { month: '2026-10', status: 'late' })
      assert.equal(late.rows, 1)
      assert.ok(late.csv.includes('Nguyễn Văn An') && !late.csv.includes('2026-10-10'))
      assert.equal((await exportAttendancesCsv(Attendance, StaffProfile, OTHER_SITE, { month: '2026-10' })).rows, 0)
      await assert.rejects(
        () => exportAttendancesCsv(Attendance, StaffProfile, SITE, { month: '2026-13' }),
        isHrError(422, 'ATTENDANCE_MONTH_INVALID'),
      )

      // A note an operator typed must not become a formula when Excel opens the file,
      // and a comma in it must stay inside one cell.
      const guarded = attendanceToCsv([{
        date: '2026-10-09',
        employeeCode: 'NV-9',
        fullName: 'Thử',
        status: 'leave',
        checkIn: null,
        checkOut: null,
        warehouseId: null,
        note: '=HYPERLINK("x"), Nghỉ',
      }], '2026-10')
      assert.ok(guarded.includes(`"'=HYPERLINK(""x""), Nghỉ"`), `got: ${guarded}`)
      assert.ok(guarded.includes(',Nghỉ phép,,,,'), 'the status is written as words, not as the stored code')
    })

    await check('attendance of another site cannot be recorded or listed', async () => {
      await assert.rejects(
        () => upsertAttendance(Attendance, StaffProfile, OTHER_SITE, { staffId: an.id, date: '2026-10-05', status: 'present' }, meta),
        isHrError(404, 'STAFF_NOT_FOUND'),
      )
      const other = await listAttendances(Attendance, OTHER_SITE, { month: '2026-10' })
      assert.deepEqual(other.data, [])
    })

    await check('salary config is effective-dated, never an edit of the past', async () => {
      const march = await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
        staffId: an.id,
        baseSalary: 20_000_000,
        allowances: [{ title: 'Ăn trưa', amount: 500_000 }],
        standardWorkDays: 26,
        effectiveFrom: '2026-03-01',
      }, meta)
      assert.equal(march.baseSalary, 20_000_000)
      assert.equal(march.allowanceTotal, 500_000)

      const october = await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
        staffId: an.id,
        baseSalary: 26_000_000,
        allowances: [{ title: 'Ăn trưa', amount: 1_000_000 }],
        standardWorkDays: 26,
        effectiveFrom: '2026-10-01',
      }, meta)
      assert.equal(october.effectiveFrom, '2026-10-01')

      const history = await listSalaryConfigs(SalaryConfig, SITE, an.id)
      assert.equal(history.length, 2, 'the March row still exists')
      assert.equal(history[0]!.baseSalary, 26_000_000, 'newest first')

      const corrected = await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
        staffId: an.id,
        baseSalary: 26_000_000,
        allowances: [{ title: 'Ăn trưa', amount: 1_000_000 }],
        note: 'Chốt lại mức lương tháng 10',
        effectiveFrom: '2026-10-01',
      }, meta)
      assert.equal(corrected.id, october.id, 'same effective date corrects that row')
      assert.equal(await SalaryConfig.countDocuments({ siteId: SITE }), 2)
    })

    let octoberPayrollId = ''
    await check('payroll is base/standard-days × paid days, plus allowances and adjustments', async () => {
      // 20 present days and 1 late day in October, 2 leave, 1 absent.
      let day = 1
      for (let index = 0; index < 20; index++) {
        await upsertAttendance(Attendance, StaffProfile, SITE, {
          staffId: an.id,
          date: `2026-10-${String(day++).padStart(2, '0')}`,
          status: 'present',
        }, meta)
      }
      await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: `2026-10-${String(day++).padStart(2, '0')}`,
        status: 'late',
      }, meta)
      for (let index = 0; index < 2; index++) {
        await upsertAttendance(Attendance, StaffProfile, SITE, {
          staffId: an.id,
          date: `2026-10-${String(day++).padStart(2, '0')}`,
          status: 'leave',
        }, meta)
      }
      await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: `2026-10-${String(day++).padStart(2, '0')}`,
        status: 'absent',
      }, meta)

      const result = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, {
        period: '2026-10',
        staffId: an.id,
        adjustments: [{ label: 'Thưởng dự án', amount: 500_000 }],
      }, meta)

      assert.equal(result.summary.created, 1)
      const line = result.lines[0]!
      assert.equal(line.outcome, 'created')
      octoberPayrollId = line.payrollId!

      const payroll = await getPayroll(Payroll, SITE, octoberPayrollId)
      assert.equal(payroll.workDays, 21, 'present + late are paid; leave and absent are not')
      assert.equal(payroll.leaveDays, 2)
      assert.equal(payroll.absentDays, 1)
      assert.equal(payroll.dailyRate, 1_000_000)
      assert.equal(payroll.basePay, 21_000_000)
      assert.equal(payroll.allowancePay, 1_000_000)
      assert.equal(payroll.adjustmentTotal, 500_000)
      assert.equal(payroll.netPay, 22_500_000)
      assert.equal(payroll.status, 'draft')
    })

    await check('recalculating unchanged inputs changes nothing and creates no second row', async () => {
      const again = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-10', staffId: an.id, adjustments: [{ label: 'Thưởng dự án', amount: 500_000 }] }, meta)

      assert.equal(again.summary.unchanged, 1)
      assert.equal(await Payroll.countDocuments({ siteId: SITE, period: '2026-10' }), 1)
    })

    await check('a changed day recalculates the draft and bumps its revision', async () => {
      await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: '2026-10-02',
        status: 'absent',
      }, meta)
      const recount = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-10', staffId: an.id, adjustments: [{ label: 'Thưởng dự án', amount: 500_000 }] }, meta)

      assert.equal(recount.summary.updated, 1)
      const payroll = await getPayroll(Payroll, SITE, octoberPayrollId)
      assert.equal(payroll.workDays, 20)
      assert.equal(payroll.revision, 2)
      assert.equal(payroll.netPay, 21_500_000)
    })

    await check('a deduction larger than the pay is refused instead of paying a negative', async () => {
      await assert.rejects(
        () => calculatePayroll(Payroll, {
          attendanceModel: Attendance,
          salaryModel: SalaryConfig,
          staffModel: StaffProfile,
          siteId: SITE,
        }, SITE, { period: '2026-10', staffId: an.id, adjustments: [{ label: 'Phạt', amount: -30_000_000 }] }, meta),
        isHrError(422, 'PAYROLL_NET_NEGATIVE'),
      )
    })

    await check('approval freezes the numbers and recalculation leaves them alone', async () => {
      const approved = await approvePayroll(Payroll, SITE, octoberPayrollId, 2, meta)
      assert.equal(approved.status, 'approved')
      assert.ok(approved.approvedAt)

      await upsertAttendance(Attendance, StaffProfile, SITE, {
        staffId: an.id,
        date: '2026-10-03',
        status: 'present',
      }, meta)
      const locked = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-10', staffId: an.id, adjustments: [{ label: 'Thưởng dự án', amount: 500_000 }] }, meta)

      assert.equal(locked.summary.locked, 1)
      const unchanged = await getPayroll(Payroll, SITE, octoberPayrollId)
      assert.equal(unchanged.netPay, 21_500_000)
      assert.equal(unchanged.revision, 3)
    })

    await check('only an approved row can be paid, and only with its current revision', async () => {
      await assert.rejects(() => payPayroll(Payroll, SITE, octoberPayrollId, 2, meta), isHrError(409, 'PAYROLL_REVISION_CONFLICT'))
      await assert.rejects(() => approvePayroll(Payroll, SITE, octoberPayrollId, 3, meta), isHrError(409, 'PAYROLL_NOT_DRAFT'))

      const paid = await payPayroll(Payroll, SITE, octoberPayrollId, 3, meta)
      assert.equal(paid.status, 'paid')
      assert.ok(paid.paidAt)

      await assert.rejects(
        () => cancelPayroll(Payroll, SITE, octoberPayrollId, 4, 'Sai số', meta),
        isHrError(409, 'PAYROLL_LOCKED'),
      )
    })

    await check('a later salary change cannot rewrite an approved or paid month', async () => {
      await setSalaryConfig(SalaryConfig, StaffProfile, SITE, {
        staffId: an.id,
        baseSalary: 40_000_000,
        effectiveFrom: '2026-10-15',
      }, meta)
      const paid = await getPayroll(Payroll, SITE, octoberPayrollId)
      assert.equal(paid.baseSalary, 26_000_000)
      assert.equal(paid.netPay, 21_500_000)
    })

    await check('a draft can be cancelled with a reason, and cancelled rows are skipped', async () => {
      const september = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-09', staffId: an.id }, meta)
      const id = september.lines[0]!.payrollId!

      await assert.rejects(() => cancelPayroll(Payroll, SITE, id, 1, '  ', meta), isHrError(422, 'PAYROLL_CANCEL_REASON_REQUIRED'))
      const cancelled = await cancelPayroll(Payroll, SITE, id, 1, 'Tính nhầm kỳ', meta)
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(cancelled.cancelReason, 'Tính nhầm kỳ')

      const recount = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-09', staffId: an.id }, meta)
      assert.equal(recount.summary.locked, 1)
    })

    await check('a batch run skips staff without a salary config instead of failing the period', async () => {
      const result = await calculatePayroll(Payroll, {
        attendanceModel: Attendance,
        salaryModel: SalaryConfig,
        staffModel: StaffProfile,
        siteId: SITE,
      }, SITE, { period: '2026-11' }, meta)

      assert.equal(result.summary.skipped, 1, 'Bình has no config yet')
      assert.equal(result.summary.created, 1)
      assert.equal(result.lines.find(row => row.outcome === 'skipped')?.reason, 'SALARY_CONFIG_MISSING')
    })

    await check('payroll totals count every state and payroll is site-scoped', async () => {
      const october = await listPayrolls(Payroll, SITE, { period: '2026-10' })
      assert.equal(october.counts.all, 1)
      assert.equal(october.counts.paid, 1)
      assert.equal(october.totals.netPay, 21_500_000)
      assert.equal(october.totals.workDays, 20)

      assert.deepEqual((await listPayrolls(Payroll, OTHER_SITE)).data, [])
      await assert.rejects(() => getPayroll(Payroll, OTHER_SITE, octoberPayrollId), isHrError(404, 'PAYROLL_NOT_FOUND'))
    })

    await check('the payroll export carries the frozen money columns, filter and all', async () => {
      const october = await exportPayrollsCsv(Payroll, SITE, { period: '2026-10' })
      const lines = october.csv.trimEnd().split('\n')
      assert.equal(october.rows, 1)
      assert.equal(october.truncated, false)
      assert.equal(lines[0], '# Bảng lương 2026-10 (1 dòng)')
      assert.equal(lines[1], 'Kỳ,Mã nhân sự,Trạng thái,Ngày công,Ngày phép,Ngày vắng,Lương tháng,Lương ngày,Lương công,Phụ cấp,Điều chỉnh,Thực lĩnh')
      assert.equal(lines[2], '2026-10,NV-001,Đã trả,20,2,2,26000000,1000000,20000000,1000000,500000,21500000')

      // A cancelled row stays visible on purpose: the sheet must explain the period,
      // and an approved month keeps the numbers it was approved with.
      const cancelled = await exportPayrollsCsv(Payroll, SITE, { status: 'cancelled' })
      assert.equal(cancelled.rows, 1)
      assert.ok(cancelled.csv.includes('2026-09,NV-001,Đã huỷ,'), `got: ${cancelled.csv}`)

      assert.equal((await exportPayrollsCsv(Payroll, OTHER_SITE, { period: '2026-10' })).rows, 0)
      await assert.rejects(
        () => exportPayrollsCsv(Payroll, SITE, { period: '2026-13' }),
        isHrError(422, 'PAYROLL_PERIOD_INVALID'),
      )

      // A code an operator typed must not become a formula when Excel opens the file.
      const guarded = payrollToCsv([{
        ...(await getPayroll(Payroll, SITE, octoberPayrollId)),
        employeeCode: '=CMD|calc',
      }], '2026-10')
      assert.ok(guarded.includes(",'=CMD|calc,"), `got: ${guarded}`)
    })

    await check('every HR mutation is audited, including the payroll transitions', async () => {
      const staffActions = (await Audit.find({ siteId: SITE, resourceType: 'staff_profile' }).lean<{ action: string }[]>()).map(row => row.action)
      for (const expected of ['create', 'update', 'delete', 'restore']) {
        assert.ok(staffActions.includes(expected), `no staff ${expected} audit row`)
      }

      const attendanceActions = (await Audit.find({ siteId: SITE, resourceType: 'attendance' }).lean<{ action: string }[]>()).map(row => row.action)
      assert.ok(attendanceActions.includes('create'))
      assert.ok(attendanceActions.includes('update'))
      assert.ok(attendanceActions.includes('delete'))

      assert.ok(await Audit.countDocuments({ siteId: SITE, resourceType: 'salary_config', action: 'create' }) >= 2)

      const payrollActions = (await Audit.find({ siteId: SITE, resourceType: 'payroll' }).lean<{ action: string }[]>()).map(row => row.action)
      for (const expected of ['create', 'update', 'approve', 'pay', 'cancel']) {
        assert.ok(payrollActions.includes(expected), `no payroll ${expected} audit row`)
      }
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await integration()

console.log(`\n${process.exitCode ? '❌' : '✅'} HR checks: ${checks} passed, ${notRun} not run\n`)
