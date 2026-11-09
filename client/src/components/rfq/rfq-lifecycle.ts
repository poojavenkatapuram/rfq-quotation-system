// Pending approval and sent are displayable states, but only quotation actions
// can produce them. This mirrors the API's manual-transition policy.
export function manualRFQStatuses(status: string, role: string | undefined): string[] {
  if (!['ADMIN', 'ESTIMATOR', 'SALES_HEAD'].includes(role ?? '')) return []
  if (status === 'WON' || status === 'LOST') return []
  if (status === 'QUOTATION_SENT') return ['WON', 'LOST']
  if (status === 'RECEIVED' && role !== 'SALES_HEAD') return ['ESTIMATING', 'LOST']
  return ['LOST']
}
