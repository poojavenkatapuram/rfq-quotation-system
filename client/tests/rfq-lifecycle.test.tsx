import { describe, expect, it } from 'vitest'
import { manualRFQStatuses } from '../src/components/rfq/rfq-lifecycle'

describe('RFQ register manual lifecycle controls', () => {
  it.each(['ADMIN', 'ESTIMATOR', 'SALES_HEAD', 'PLANT_HEAD'])("never exposes workflow-owned statuses for %s", role => {
    for (const status of ['RECEIVED', 'ESTIMATING', 'PENDING_APPROVAL', 'QUOTATION_SENT', 'WON', 'LOST']) {
      const options = manualRFQStatuses(status, role)
      expect(options).not.toContain('QUOTATION_SENT')
      expect(options).not.toContain('PENDING_APPROVAL')
    }
  })
  it('lets estimators start estimating and requires sending before winning', () => {
    expect(manualRFQStatuses('RECEIVED', 'ESTIMATOR')).toEqual(['ESTIMATING', 'LOST'])
    expect(manualRFQStatuses('ESTIMATING', 'ESTIMATOR')).toEqual(['LOST'])
    expect(manualRFQStatuses('QUOTATION_SENT', 'ESTIMATOR')).toEqual(['WON', 'LOST'])
  })
  it('limits Sales Heads to outcomes and Plant Heads to read-only status', () => {
    expect(manualRFQStatuses('RECEIVED', 'SALES_HEAD')).toEqual(['LOST'])
    expect(manualRFQStatuses('QUOTATION_SENT', 'SALES_HEAD')).toEqual(['WON', 'LOST'])
    expect(manualRFQStatuses('QUOTATION_SENT', 'PLANT_HEAD')).toEqual([])
    expect(manualRFQStatuses('RECEIVED', undefined)).toEqual([])
  })
  it.each(['WON', 'LOST'])('keeps closed %s RFQs closed', status => {
    expect(manualRFQStatuses(status, 'ADMIN')).toEqual([])
  })
})
