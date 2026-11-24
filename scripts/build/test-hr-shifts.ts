import { dropTestDatabase, testDatabaseBinding } from './testDatabase.js'
import assert from 'node:assert/strict'
type LeanId = { _id: string }
import { HrServiceError } from '../../tm-cms/server/services/staffService.js'
import {
  archiveShiftTemplate,
  assignShift,
  cancelShiftAssignment,
  createShiftTemplate,
  listShiftAssignments,
  listShiftTemplates,
  updateShiftTemplate,
} from '../../tm-cms/server/services/shiftService.js'
import { shiftSpanMinutes, shiftWorkedMinutes } from '../../tm-cms/server/models/shiftTemplate.js'
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
/** 12:00 in Vietnam on 15 November 2026. */
const NOW = new Date('2026-11-15T05:00:00.000Z')
const TODAY = '2026-11-15'

console.log('HR shifts — templates, a one-shift-per-day roster, and a past that stays put\n')

const URI = process.env.TM_TEST_MONGO_URI || 'mongodb://127.0.0.1:27017'
const binding = testDatabaseBinding('tm_test_hr_shifts')

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
    await dropTestDatabase(connection)
    const models = await prepareDatabase(connection)
    const { ShiftTemplate, ShiftAssignment, StaffProfile, Audit } = models
    const audit = { model: Audit, actor: { id: 'test-operator', name: 'Test operator', email: '' } }
    const crew = { ShiftTemplate, ShiftAssignment, StaffProfile }

    const an = (await StaffProfile.create({
      siteId: SITE,
      subjectId: 'subject-an',
      employeeCode: 'NV-001',
      fullName: 'Nguyễn Thị An',
      workStatus: 'official',
    })).toObject() as LeanId
    const binh = (await StaffProfile.create({
      siteId: SITE,
      subjectId: 'subject-binh',
      employeeCode: 'NV-002',
      fullName: 'Trần Văn Bình',
      workStatus: 'probation',
    })).toObject() as LeanId
    let chiId = ''
    const cu = (await StaffProfile.create({
      siteId: SITE,
      subjectId: 'subject-cu',
      employeeCode: 'NV-003',
      fullName: 'Lê Văn Cũ',
      workStatus: 'resigned',
    })).toObject() as LeanId

    await check('an overnight shift is a duration, not an error', async () => {
      assert.equal(shiftSpanMinutes('08:00', '12:00'), 240)
      assert.equal(shiftSpanMinutes('22:00', '06:00'), 480)
      assert.equal(shiftWorkedMinutes('22:00', '06:00', 30), 450)
    })

    const morning = await createShiftTemplate(ShiftTemplate, SITE, {
      code: ' sang ',
      name: 'Ca sáng',
      startTime: '08:00',
      endTime: '12:00',
      breakMinutes: 0,
    }, { audit })

    await check('a template normalizes its code and reports paid minutes', async () => {
      assert.equal(morning.template.code, 'SANG')
      assert.equal(morning.template.spanMinutes, 240)
      assert.equal(morning.template.workedMinutes, 240)
      assert.equal(morning.template.overnight, false)
      assert.equal(morning.template.revision, 1)
    })

    await check('an impossible break or a full-day span is refused', async () => {
      await assert.rejects(
        () => createShiftTemplate(ShiftTemplate, SITE, { code: 'X', name: 'X', startTime: '08:00', endTime: '09:00', breakMinutes: 60 }, { audit }),
        isHrError(422, 'SHIFT_BREAK_TOO_LONG'),
      )
      await assert.rejects(
        () => createShiftTemplate(ShiftTemplate, SITE, { code: 'Y', name: 'Y', startTime: '08:00', endTime: '08:00' }, { audit }),
        isHrError(422, 'SHIFT_DURATION_INVALID'),
      )
      await assert.rejects(
        () => createShiftTemplate(ShiftTemplate, SITE, { code: 'Z', name: 'Z', startTime: '25:00', endTime: '26:00' }, { audit }),
        isHrError(422, 'SHIFT_TEMPLATE_PAYLOAD_INVALID'),
      )
    })

    await check('a code is unique per site, so the same code cannot exist twice', async () => {
      await assert.rejects(
        () => createShiftTemplate(ShiftTemplate, SITE, { code: 'sang', name: 'Ca sáng 2', startTime: '13:00', endTime: '17:00' }, { audit }),
        isHrError(409, 'SHIFT_CODE_TAKEN'),
      )
      const other = await createShiftTemplate(ShiftTemplate, OTHER_SITE, {
        code: 'SANG', name: 'Ca sáng', startTime: '08:00', endTime: '12:00',
      }, { audit })
      assert.equal(other.template.code, 'SANG')
    })

    const night = await createShiftTemplate(ShiftTemplate, SITE, {
      code: 'DEM',
      name: 'Ca đêm',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 45,
    }, { audit })

    await check('editing a template keeps the revision honest', async () => {
      const updated = await updateShiftTemplate(ShiftTemplate, SITE, night.template.id, {
        name: 'Ca đêm (22h–6h)',
        revision: 1,
      }, { audit })
      assert.equal(updated.name, 'Ca đêm (22h–6h)')
      assert.equal(updated.revision, 2)
      assert.equal(updated.overnight, true)
      assert.equal(updated.workedMinutes, 435)

      await assert.rejects(
        () => updateShiftTemplate(ShiftTemplate, SITE, night.template.id, { name: 'Ghi đè', revision: 1 }, { audit }),
        isHrError(409, 'SHIFT_REVISION_CONFLICT'),
      )
      await assert.rejects(
        () => updateShiftTemplate(ShiftTemplate, SITE, night.template.id, { startTime: '22:00', endTime: '22:00' }, { audit }),
        isHrError(422, 'SHIFT_DURATION_INVALID'),
      )
    })

    const tomorrow = '2026-11-16'
    const assigned = await assignShift(crew, SITE, {
      templateId: night.template.id,
      staffId: String(an._id),
      date: tomorrow,
    }, { now: NOW }, { audit })

    await check('an assignment freezes the template it was scheduled with', async () => {
      assert.equal(assigned.assignment.shiftCode, 'DEM')
      assert.equal(assigned.assignment.startTime, '22:00')
      assert.equal(assigned.assignment.workedMinutes, 435)
      assert.equal(assigned.assignment.staffName, 'Nguyễn Thị An')
      assert.equal(assigned.assignment.date, tomorrow)

      await updateShiftTemplate(ShiftTemplate, SITE, night.template.id, {
        startTime: '21:00',
        endTime: '05:00',
      }, { audit })
      const roster = await listShiftAssignments({ ShiftAssignment, StaffProfile }, SITE, { from: tomorrow, to: tomorrow })
      assert.equal(roster.data[0]!.startTime, '22:00', 'a published roster is not rewritten by a template edit')
    })

    await check('one person is in one place per day', async () => {
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: morning.template.id, staffId: String(an._id), date: tomorrow }, { now: NOW }, { audit }),
        isHrError(409, 'SHIFT_ALREADY_ASSIGNED'),
      )
    })

    await check('a resigned person, an inactive shift and an unknown staff member are refused', async () => {
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: morning.template.id, staffId: String(cu._id), date: tomorrow }, { now: NOW }, { audit }),
        isHrError(409, 'STAFF_RESIGNED'),
      )
      const inactive = await createShiftTemplate(ShiftTemplate, SITE, {
        code: 'TAMNGUNG', name: 'Ca tạm ngưng', startTime: '13:00', endTime: '17:00', isActive: false,
      }, { audit })
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: inactive.template.id, staffId: String(binh._id), date: tomorrow }, { now: NOW }, { audit }),
        isHrError(409, 'SHIFT_TEMPLATE_INACTIVE'),
      )
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: morning.template.id, staffId: '651111111111111111111111', date: tomorrow }, { now: NOW }, { audit }),
        isHrError(404, 'STAFF_NOT_FOUND'),
      )
    })

    await check('the roster cannot be backdated and looks at most 180 days ahead', async () => {
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: morning.template.id, staffId: String(binh._id), date: '2026-11-14' }, { now: NOW }, { audit }),
        isHrError(409, 'SHIFT_DATE_IN_PAST'),
      )
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: morning.template.id, staffId: String(binh._id), date: '2027-06-01' }, { now: NOW }, { audit }),
        isHrError(422, 'SHIFT_DATE_TOO_FAR'),
      )
    })

    await check('capacity stops a shift from being over-filled', async () => {
      const binhShift = await assignShift(crew, SITE, {
        templateId: night.template.id,
        staffId: String(binh._id),
        date: tomorrow,
      }, { now: NOW }, { audit })
      assert.equal(binhShift.assignment.shiftCode, 'DEM')

      const limited = await createShiftTemplate(ShiftTemplate, SITE, {
        code: 'CHIEU', name: 'Ca chiều', startTime: '13:00', endTime: '17:00', capacity: 1,
      }, { audit })
      const chi = await StaffProfile.create({
        siteId: SITE, subjectId: 'subject-chi', employeeCode: 'NV-004', fullName: 'Phạm Thị Chi', workStatus: 'official',
      })
      chiId = String(chi._id)
      await assignShift(crew, SITE, { templateId: limited.template.id, staffId: chiId, date: tomorrow }, { now: NOW }, { audit })

      const dung = await StaffProfile.create({
        siteId: SITE, subjectId: 'subject-dung', employeeCode: 'NV-005', fullName: 'Hoàng Văn Dũng', workStatus: 'official',
      })
      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: limited.template.id, staffId: String(dung._id), date: tomorrow }, { now: NOW }, { audit }),
        isHrError(409, 'SHIFT_CAPACITY_REACHED'),
      )
    })

    await check('a roster range summarises people, days and paid minutes', async () => {
      const roster = await listShiftAssignments({ ShiftAssignment, StaffProfile }, SITE, { from: TODAY, to: '2026-11-20' })
      assert.equal(roster.summary.assignments, 3)
      assert.equal(roster.summary.staff, 3)
      assert.equal(roster.summary.days, 1)
      assert.equal(roster.summary.workedMinutes, 1110)
      assert.deepEqual(roster.range, { from: TODAY, to: '2026-11-20' })

      const mine = await listShiftAssignments({ ShiftAssignment, StaffProfile }, SITE, { from: TODAY, to: '2026-11-20', staffId: String(an._id) })
      assert.equal(mine.summary.assignments, 1)

      await assert.rejects(
        () => listShiftAssignments({ ShiftAssignment, StaffProfile }, SITE, { from: '2026-01-01', to: '2026-12-31' }),
        isHrError(422, 'SHIFT_RANGE_TOO_LONG'),
      )
      await assert.rejects(
        () => listShiftAssignments({ ShiftAssignment, StaffProfile }, SITE, { from: '2026-11-20', to: '2026-11-15' }),
        isHrError(422, 'SHIFT_RANGE_INVALID'),
      )
    })

    await check('a shift that already happened cannot be withdrawn, and a future one can', async () => {
      await ShiftAssignment.create({
        siteId: SITE,
        templateId: night.template.id,
        shiftCode: 'DEM',
        staffId: chiId,
        employeeCode: 'NV-004',
        date: '2026-11-10',
        startTime: '22:00',
        endTime: '06:00',
      })
      const past = await ShiftAssignment.findOne({ siteId: SITE, date: '2026-11-10' }).lean<LeanId | null>()
      await assert.rejects(
        () => cancelShiftAssignment(ShiftAssignment, SITE, String(past!._id), NOW, { audit }),
        isHrError(409, 'SHIFT_ASSIGNMENT_STARTED'),
      )

      await cancelShiftAssignment(ShiftAssignment, SITE, assigned.assignment.id, NOW, { audit })
      assert.equal(await ShiftAssignment.countDocuments({ siteId: SITE, _id: assigned.assignment.id }), 0)
      await assert.rejects(
        () => cancelShiftAssignment(ShiftAssignment, SITE, assigned.assignment.id, NOW, { audit }),
        isHrError(404, 'SHIFT_ASSIGNMENT_NOT_FOUND'),
      )
    })

    await check('a shift still on the roster cannot be archived', async () => {
      await assert.rejects(
        () => archiveShiftTemplate(ShiftTemplate, ShiftAssignment, SITE, night.template.id, NOW, { audit }),
        isHrError(409, 'SHIFT_TEMPLATE_IN_USE'),
      )

      const binhShift = await ShiftAssignment.findOne({ siteId: SITE, staffId: String(binh._id), date: tomorrow })
        .lean<LeanId | null>()
      await cancelShiftAssignment(ShiftAssignment, SITE, String(binhShift!._id), NOW, { audit })
      await archiveShiftTemplate(ShiftTemplate, ShiftAssignment, SITE, night.template.id, NOW, { audit })

      const live = await listShiftTemplates(ShiftTemplate, SITE, { includeInactive: true })
      assert.equal(live.data.some(row => row.code === 'DEM'), false, 'archived shifts leave the picker')

      await assert.rejects(
        () => assignShift(crew, SITE, { templateId: night.template.id, staffId: String(binh._id), date: '2026-11-17' }, { now: NOW }, { audit }),
        isHrError(404, 'SHIFT_TEMPLATE_NOT_FOUND'),
      )
    })

    await check('the trail records who defined and who scheduled', async () => {
      const rows = await Audit.find({ siteId: SITE }).select({ resourceType: 1, action: 1, resourceKey: 1 })
        .lean<{ resourceType: string, action: string, resourceKey: string }[]>()
      assert.ok(rows.some(row => row.resourceType === 'shift_template' && row.action === 'create'))
      assert.ok(rows.some(row => row.resourceType === 'shift_template' && row.action === 'archive'))
      assert.ok(rows.some(row => row.resourceType === 'shift_assignment' && row.action === 'create' && row.resourceKey === 'NV-001:2026-11-16'))
      assert.ok(rows.some(row => row.resourceType === 'shift_assignment' && row.action === 'cancel'))
    })

    await check('two tenants share no roster', async () => {
      const other = await listShiftAssignments({ ShiftAssignment, StaffProfile }, OTHER_SITE, { from: TODAY, to: '2026-11-20' })
      assert.equal(other.summary.assignments, 0)
      const templates = await listShiftTemplates(ShiftTemplate, OTHER_SITE)
      assert.deepEqual(templates.data.map(row => row.code), ['SANG'])
    })
  } finally {
    await connection.db?.dropDatabase().catch(() => undefined)
    await closeDatabaseConnections()
  }
}

await run()

console.log(`\n${process.exitCode ? '❌' : '✅'} Shift checks: ${checks} passed, ${notRun} not run\n`)
