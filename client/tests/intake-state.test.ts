import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confidenceLabel, draftForGroup, groupId, hasConflicts, hasDuplicateParts,
  hasUnsavedReviews, isPartField, mergeJobs, qualifiedFields, savedValue } from '../src/components/intake/intake-state.ts'
import type { Field, Job } from '../src/components/intake/intake-state.ts'

const field = (overrides: Partial<Field> = {}): Field => ({ id: 'field-1', fieldName: 'materialGrade', extractedValue: 'EN8',
  acceptedValue: 'EN8', confidence: 0.9, sourceReference: 'Sheet Parts, A2', sourceId: 'excel-sheet-1-row-2-1',
  evidenceText: 'Material: EN8', extractionMethod: 'DETERMINISTIC', groupKey: 'part:excel-sheet-1-row-2', reviewStatus: 'ACCEPTED', ...overrides })
const job = (id: string, fields = [field()]): Job => ({ id, status: 'COMPLETED', fields })

test('identical group keys from separate documents never mix parts', () => {
  const first = job('one'); const second = job('two', [field({ id: 'field-2', fieldName: 'annualVolume', acceptedValue: '500' })])
  const fields = qualifiedFields([first, second])
  const a = groupId(first.id, first.fields[0]); const b = groupId(second.id, second.fields[0])
  assert.notEqual(a, b)
  assert.equal(draftForGroup(fields, a).materialGrade, 'EN8')
  assert.equal(draftForGroup(fields, a).annualVolume, '')
  assert.equal(draftForGroup(fields, b).materialGrade, '')
  assert.equal(draftForGroup(fields, b).annualVolume, '500')
})
test('unsaved edits never enter defaults and block readiness', () => {
  const fields = qualifiedFields([job('one')])
  assert.equal(hasUnsavedReviews(fields, { 'field-1': 'UNSAVED' }), true)
  assert.equal(draftForGroup(fields, fields[0].groupKey!, { materialGrade: 'UNSAVED' }).materialGrade, 'EN8')
  assert.equal(hasUnsavedReviews(fields, { 'field-1': 'EN8' }), false)
})
test('pending and rejected values never populate part, RFQ or customer defaults', () => {
  for (const reviewStatus of ['PENDING', 'REJECTED'] as const) {
    const fields = [field({ reviewStatus }), field({ fieldName: 'rfqNumber', reviewStatus }), field({ fieldName: 'customerName', reviewStatus })]
    assert.equal(savedValue(fields, 'rfqNumber'), '')
    assert.equal(savedValue(fields, 'customerName'), '')
    assert.equal(draftForGroup(fields, fields[0].groupKey!).materialGrade, '')
  }
})
test('later reviews update drafts without stale copies of source fields', () => {
  const fields = qualifiedFields([job('one')]); const group = fields[0].groupKey!
  const manual = { name: 'Manually reviewed part' }
  assert.equal(draftForGroup(fields, group, manual).materialGrade, 'EN8')
  fields[0].acceptedValue = 'EN19'
  assert.equal(draftForGroup(fields, group, manual).materialGrade, 'EN19')
  assert.equal(draftForGroup(fields, group, manual).name, manual.name)
})
test('duplicate uploads retain one job and saved review progress', () => {
  const current = job('one')
  assert.deepEqual(mergeJobs([current], [current, current]), [current])
  assert.equal(mergeJobs([current], [job('two')])[0].fields[0].reviewStatus, 'ACCEPTED')
})
test('failed extraction cards remain retryable and are replaced on success', () => {
  const failed: Job = { ...job('one', []), status: 'FAILED', errorMessage: 'OCR failed' }
  const cards = mergeJobs([], [failed])
  assert.equal(cards[0].status, 'FAILED')
  assert.equal(mergeJobs(cards, [job('one')]).length, 1)
  assert.equal(mergeJobs(cards, [job('one')])[0].status, 'COMPLETED')
})
test('accepted conflicts have no default until resolved; headers are not part groups', () => {
  const fields = [field(), field({ id: 'field-2', acceptedValue: 'EN19' })]
  assert.equal(hasConflicts(fields), true)
  assert.equal(savedValue(fields, 'materialGrade', fields[0].groupKey!), '')
  fields[1].reviewStatus = 'REJECTED'
  assert.equal(hasConflicts(fields), false)
  assert.equal(isPartField(field({ fieldName: 'customerName' })), false)
  assert.equal(isPartField(field({ fieldName: 'rfqNumber' })), false)
})
test('ambiguous quantities and net weights never populate gross kilograms or annual volume', () => {
  const fields = [field({ fieldName: 'weightUnspecified' }), field({ fieldName: 'quantityUnspecified' }), field({ fieldName: 'netWeightKg' })]
  assert.equal(draftForGroup(fields, fields[0].groupKey!).grossWeightKg, '')
  assert.equal(draftForGroup(fields, fields[0].groupKey!).annualVolume, '')
})
test('confidence is an uncertainty indicator, never a probability', () => {
  assert.equal(confidenceLabel(null), 'Uncertainty unknown')
  assert.equal(confidenceLabel(0.2), 'High uncertainty')
  for (const score of [0, 0.5, 0.9, 1, '0.95']) assert.doesNotMatch(confidenceLabel(score), /%|probability/)
})
test('duplicate part identifiers require correction or exclusion', () => {
  const part = { partNumber: 'P-1', drawingNumber: 'D-1', revision: 'A' }
  assert.equal(hasDuplicateParts([part, { ...part, partNumber: 'p-1' }]), true)
  assert.equal(hasDuplicateParts([part, { ...part, revision: 'B' }]), false)
})
