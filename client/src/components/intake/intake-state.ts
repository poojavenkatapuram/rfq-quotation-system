export type Field = {
  id: string; fieldName: string; extractedValue: string; acceptedValue: string | null
  confidence: number | string | null; sourceReference: string | null; sourceId: string | null
  evidenceText: string | null; extractionMethod: string | null; groupKey: string | null
  reviewStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED'
}
export type Job = {
  id: string; status: string; errorMessage?: string | null
  attachment?: { fileName: string; mimeType: string } | null
  fields: Field[]
}
export type Draft = {
  partNumber: string; name: string; materialGrade: string
  grossWeightKg: string; annualVolume: string; drawingNumber: string; revision: string
}

export const groupId = (jobId: string, field: Field) => `${jobId}::${field.groupKey || 'document'}`
export const qualifiedFields = (jobs: Job[]): Field[] => jobs.flatMap((job) =>
  job.fields.map((field) => ({ ...field, groupKey: groupId(job.id, field) })))
export const isPartField = (field: Field) => !['rfqNumber', 'customerName', 'emailFrom', 'emailSubject', 'emailDate', 'deliveryRequirements', 'commercialTerms'].includes(field.fieldName)

// Only server-saved reviews supply defaults. Editable input buffers are never read here.
export function savedValue(fields: Field[], name: string, group?: string): string {
  const values = new Set(fields.filter((field) => field.fieldName === name &&
    (group === undefined || field.groupKey === group) && field.reviewStatus === 'ACCEPTED')
    .map((field) => field.acceptedValue?.trim()).filter((value): value is string => Boolean(value)))
  return values.size === 1 ? [...values][0] : ''
}
export function hasConflicts(fields: Field[]): boolean {
  const buckets = new Map<string, Set<string>>()
  for (const field of fields.filter((field) => field.reviewStatus === 'ACCEPTED')) {
    const key = `${isPartField(field) ? field.groupKey : 'rfq'}:${field.fieldName}`
    const values = buckets.get(key) || new Set<string>()
    values.add(field.acceptedValue?.trim() || '')
    buckets.set(key, values)
  }
  return [...buckets.values()].some((values) => values.size > 1)
}
export function hasUnsavedReviews(fields: Field[], edits: Record<string, string>): boolean {
  return fields.some((field) => field.reviewStatus === 'ACCEPTED' &&
    edits[field.id] !== undefined && edits[field.id].trim() !== field.acceptedValue)
}
export function draftForGroup(fields: Field[], group: string, manual: Partial<Draft> = {}): Draft {
  const value = (key: keyof Draft, field = key as string) => savedValue(fields, field, group) || manual[key] || ''
  return { partNumber: value('partNumber'), name: value('name', 'partName'), materialGrade: value('materialGrade'),
    grossWeightKg: value('grossWeightKg'), annualVolume: value('annualVolume'),
    drawingNumber: value('drawingNumber'), revision: value('revision') }
}
export function mergeJobs(current: Job[], incoming: Job[]): Job[] {
  const merged = new Map(current.map((job) => [job.id, job]))
  for (const job of incoming) merged.set(job.id, job)
  return [...merged.values()]
}
export function confidenceLabel(value: Field['confidence']): string {
  if (value === null || value === '') return 'Uncertainty unknown'
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > 1) return 'Uncertainty unknown'
  return score < 0.6 ? 'High uncertainty' : 'Needs source verification'
}
export function hasDuplicateParts(parts: Array<Pick<Draft, 'partNumber' | 'drawingNumber' | 'revision'>>): boolean {
  const identifiers = new Set<string>()
  return parts.some((part) => {
    const number = part.partNumber.trim() || part.drawingNumber.trim()
    if (!number) return false
    const key = `${number}:${part.revision.trim()}`.toLowerCase()
    if (identifiers.has(key)) return true
    identifiers.add(key)
    return false
  })
}
