import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle, ArrowRight, CheckCircle2, FileSpreadsheet, FileText,
  LoaderCircle, Mail, Plus, RotateCcw, Upload, XCircle,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
import './RFQIntake.css'
import { confidenceLabel, draftForGroup, groupId, hasConflicts, hasDuplicateParts,
  hasUnsavedReviews, isPartField, mergeJobs, qualifiedFields, savedValue } from './intake-state'
import type { Draft, Field, Job } from './intake-state'
type Customer = { id: string; name: string; code: string }
type CustomerForm = {
  name: string; code: string; email: string; phone: string; address: string; gstNumber: string
}
const labels: Record<string, string> = {
  rfqNumber: 'RFQ number', customerName: 'Customer name', partNumber: 'Part number',
  emailFrom: 'Email sender', emailSubject: 'Email subject', emailDate: 'Email date',
  partName: 'Part name', materialGrade: 'Material grade', grossWeightKg: 'Gross weight (kg)',
  annualVolume: 'Annual volume', drawingNumber: 'Drawing number', revision: 'Drawing revision',
  drawingScale: 'Drawing scale', cycleTimeMinutes: 'Cycle time (minutes)',
  deliveryRequirements: 'Delivery requirements', commercialTerms: 'Commercial terms',
  netWeightKg: 'Net weight (kg; not gross weight)', weightUnspecified: 'Weight — type or unit needs review',
  quantityUnspecified: 'Quantity — annual demand not established', dimensions: 'Dimensions', technicalSpecifications: 'Technical specifications',
}
const emptyDraft = (): Draft => ({
  partNumber: '', name: '', materialGrade: '', grossWeightKg: '', annualVolume: '', drawingNumber: '', revision: '',
})
const emptyCustomerForm = (): CustomerForm => ({
  name: '', code: '', email: '', phone: '', address: '', gstNumber: '',
})
const message = (error: unknown) => {
  const data = (error as { response?: { data?: { message?: string } } })?.response?.data
  return data?.message || 'Something went wrong. Please try again.'
}
const groupLabel = (key: string) => key.includes('excel-sheet-') ?
  'Sheet ' + key.match(/sheet-(\d+)/)?.[1] + ', part row ' + key.match(/row-(\d+)/)?.[1] :
  key.includes('pdf-page-') ? 'Page ' + key.match(/page-(\d+)/)?.[1] + ', block ' + key.match(/block-(\d+)/)?.[1] :
  key.startsWith('manual:') ? 'Manually added part' : 'Document details'

export default function RFQIntake() {
  const { user } = useAuth()
  const canManageCustomers = user?.role === 'ADMIN'
  const input = useRef<HTMLInputElement>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, Partial<Draft>>>({})
  const [manualGroups, setManualGroups] = useState<string[]>([])
  const [excludedGroups, setExcludedGroups] = useState<string[]>([])
  const [failedUploads, setFailedUploads] = useState<Array<{ id: string; file: File; message: string }>>([])
  const [confirmedSignature, setConfirmedSignature] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [customerId, setCustomerId] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customersLoading, setCustomersLoading] = useState(false)
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [customerForm, setCustomerForm] = useState<CustomerForm>(emptyCustomerForm())
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [manualRfqNumber, setRfqNumber] = useState<string | undefined>()
  const [manualCustomerName, setCustomerName] = useState<string | undefined>()
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const fields = qualifiedFields(jobs)
  const rfqNumber = manualRfqNumber ?? savedValue(fields, 'rfqNumber')
  const customerName = manualCustomerName ?? savedValue(fields, 'customerName')
  const sourceGroups = Array.from(new Set(fields.filter(isPartField).map((field) => field.groupKey!)))
  const groups = Array.from(new Set([...sourceGroups, ...manualGroups])).filter((group) => !excludedGroups.includes(group))
  const allReviewed = fields.every((field) => field.reviewStatus !== 'PENDING')
  const allJobsCompleted = jobs.length > 0 && !failedUploads.length && jobs.every((job) => job.status === 'COMPLETED')
  const completedJobs = jobs.filter((job) => job.status === 'COMPLETED')
  const dirtyReviews = hasUnsavedReviews(fields, values)
  const conflicts = hasConflicts(fields)
  const draft = (group: string): Draft => draftForGroup(fields, group, drafts[group])
  const signature = JSON.stringify({ rfqNumber, customerName, customerId, receivedDate, dueDate, notes,
    parts: groups.map((group) => [group, draft(group)]), jobs: jobs.map((job) => job.id),
    reviews: fields.map((field) => [field.id, field.reviewStatus, field.acceptedValue]) })
  const confirmed = confirmedSignature === signature
  const updateDraft = (group: string, key: keyof Draft, value: string) =>
    setDrafts((current) => ({ ...current, [group]: { ...current[group], [key]: value } }))
  const replaceJob = (updated: Job) =>
    setJobs((current) => current.map((job) => job.id === updated.id ? updated : job))
  const sourceDocument = (group: string) => jobs.find((job) => group.startsWith(job.id + '::'))?.attachment?.fileName

  useEffect(() => {
    if (!jobs.length && !failedUploads.length) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [jobs.length, failedUploads.length])

  const refreshCustomers = async () => {
    setCustomersLoading(true)
    try {
      const customerResponse = await api.get('/customers')
      setCustomers(customerResponse.data.data || [])
    } finally {
      setCustomersLoading(false)
    }
  }

  const upload = async (files?: FileList | File[] | null, retryId?: string) => {
    const selected = Array.from(files || [])
    if (!selected.length) return
    if (selected.length > 10) { setError('Choose no more than 10 documents.'); return }
    if (retryId) setFailedUploads((current) => current.filter((item) => item.id !== retryId))
    setLoading(true); setError(''); setSuccess('')
    const form = new FormData()
    selected.forEach((file) => form.append('files', file))
    try {
      const response = await api.post('/document-intake/uploads', form, { headers: { 'Content-Type': undefined } })
      const results: Array<{ extractionJob?: Job; statusCode: number; message: string; duplicateOfAttachmentId?: string }> = response.data.results || []
      const next = results.map((item) => item.extractionJob)
        .filter((job: Job | undefined): job is Job => Boolean(job))
      if (next.length) {
        setJobs((current) => mergeJobs(current, next))
        setValues((current) => {
          const updated = { ...current }
          next.forEach((job) => job.fields.forEach((field) => {
            updated[field.id] ??= field.acceptedValue ?? field.extractedValue
          }))
          return updated
        })
        try { await refreshCustomers() } catch { setError('Documents retained. Could not refresh customers; retry the customer directory below.') }
      }
      setFailedUploads((current) => [...current, ...results.flatMap((result, index) =>
        !result.extractionJob && result.statusCode !== 201 && selected[index]
          ? [{ id: crypto.randomUUID(), file: selected[index], message: result.message }] : [])])
      if (results.some((result) => result.duplicateOfAttachmentId)) setSuccess('Duplicate documents reused their existing extraction and review progress.')
      const failed = results.filter((item: { statusCode: number }) => item.statusCode !== 201)
      if (failed.length) setError(failed.length + ' document(s) could not be processed.')
    } catch (requestError) {
      setError(message(requestError))
      setFailedUploads((current) => [...current, ...selected.map((file) => ({ id: crypto.randomUUID(), file, message: message(requestError) }))])
    } finally {
      setLoading(false)
      if (input.current) input.current.value = ''
    }
  }

  const review = async (jobId: string, field: Field, decision: 'ACCEPTED' | 'REJECTED', unavailable = false) => {
    const acceptedValue = (values[field.id] || '').trim()
    if (decision === 'ACCEPTED' && !acceptedValue) {
      setError('Enter a value before accepting this field.')
      return
    }
    setSaving(field.id); setError(''); setSuccess('')
    try {
      const response = await api.patch('/document-intake/' + jobId + '/review', {
        fields: [{ id: field.id, decision, unavailable, ...(decision === 'ACCEPTED' && { acceptedValue }) }],
      })
      replaceJob(response.data.extractionJob)
      const saved: Field | undefined = response.data.extractionJob.fields.find((item: Field) => item.id === field.id)
      if (saved) setValues((current) => ({ ...current, [field.id]: saved.acceptedValue ?? saved.extractedValue }))
      setSuccess(decision === 'ACCEPTED' ? 'Field accepted.' : 'Field rejected.')
    } catch (requestError) {
      const failedJob = (requestError as { response?: { data?: { extractionJob?: Job } } }).response?.data?.extractionJob
      if (failedJob) replaceJob(failedJob)
      setError(message(requestError))
    } finally {
      setSaving('')
    }
  }

  const retry = async (id: string) => {
    setSaving(id); setError('')
    try {
      const response = await api.post('/document-intake/' + id + '/retry')
      replaceJob(response.data.extractionJob)
      setValues((current) => {
        const updated = { ...current }
        response.data.extractionJob.fields.forEach((field: Field) => {
          updated[field.id] = field.acceptedValue ?? field.extractedValue
        })
        return updated
      })
      setSuccess('Extraction retried. Review its suggestions before creating the RFQ.')
    } catch (requestError) {
      const failedJob = (requestError as { response?: { data?: { extractionJob?: Job } } }).response?.data?.extractionJob
      if (failedJob) replaceJob(failedJob)
      setError(message(requestError))
    } finally {
      setSaving('')
    }
  }

  const create = async () => {
    if (loading || saving || creating || dirtyReviews || conflicts || !confirmed) {
      setError('Save or reject edits, resolve conflicting accepted values, and confirm the final RFQ details.'); return
    }
    if (!allJobsCompleted) {
      setError('Retry or remove every failed document before creating the RFQ.')
      return
    }
    if (!allReviewed) {
      setError('Accept or reject every extracted suggestion before creating the RFQ.')
      return
    }
    if (!rfqNumber.trim() || !customerName.trim()) {
      setError('Enter the RFQ number and customer name.')
      return
    }
    const customer = customers.find((item) => item.id === customerId)
    if (!customer) {
      setError('Select the correct customer before creating the RFQ.')
      return
    }
    let parts: Array<Record<string, string | number | undefined>>
    if (hasDuplicateParts(groups.map(draft))) { setError('Duplicate part/drawing numbers found. Exclude the duplicate source group or correct its reviewed identifier.'); return }
    try {
      parts = groups.map((group) => {
        const current = draft(group)
        const grossWeightKg = current.grossWeightKg ? Number(current.grossWeightKg.replace(/,/g, '')) : undefined
        const annualVolume = current.annualVolume ? Number(current.annualVolume.replace(/,/g, '')) : undefined
        if ((grossWeightKg !== undefined && (!Number.isFinite(grossWeightKg) || grossWeightKg <= 0)) ||
          (annualVolume !== undefined && (!Number.isSafeInteger(annualVolume) || annualVolume <= 0))) {
          throw new Error('Part weights and annual volumes must be positive numeric values.')
        }
        return {
          partNumber: current.partNumber.trim() || undefined,
          name: current.name.trim(),
          materialGrade: current.materialGrade.trim() || undefined,
          grossWeightKg, annualVolume,
          drawingNumber: current.drawingNumber.trim() || undefined,
          revision: current.revision.trim() || undefined,
          sourceGroupKey: group.startsWith('manual:') ? undefined : group,
        }
      })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Invalid part value.')
      return
    }
    if (!parts.length || parts.some((part) => !part.name)) {
      setError('Enter a part name for every document or Excel-row group.')
      return
    }
    setCreating(true); setError(''); setSuccess('')
    try {
      await api.post('/rfqs', {
        rfqNumber: rfqNumber.trim(), customerId: customer.id,
        receivedDate: receivedDate || undefined, dueDate: dueDate || undefined,
        notes: notes.trim() || undefined, parts, extractionJobIds: jobs.map((job) => job.id),
      })
      setSuccess('RFQ ' + rfqNumber.trim() + ' created with ' + parts.length + ' part(s) and ' + jobs.length + ' attachment(s).')
      setJobs([]); setValues({}); setDrafts({}); setManualGroups([]); setExcludedGroups([]); setConfirmedSignature('')
      setRfqNumber(undefined); setCustomerName(undefined); setNotes(''); setCustomerId(''); setCustomerSearch('')
    } catch (requestError) {
      setError(message(requestError))
    } finally {
      setCreating(false)
    }
  }

  const exactMatches = customers.filter((item) =>
    item.name.trim().toLowerCase() === customerName.trim().toLowerCase() ||
    item.code.trim().toLowerCase() === customerName.trim().toLowerCase())
  const visibleCustomers = customers.filter((item) => {
    const query = customerSearch.trim().toLowerCase()
    return !query || item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
  })

  const openCustomerForm = () => {
    setCustomerForm({ ...emptyCustomerForm(), name: customerName.trim() })
    setError('')
    setShowCustomerForm(true)
  }

  const createCustomer = async () => {
    if (loading || saving || dirtyReviews || conflicts) { setError('Save all reviews and resolve conflicts first.'); return }
    if (!allJobsCompleted) {
      setError('Retry or remove every failed document before creating a customer from intake data.')
      return
    }
    if (!allReviewed) {
      setError('Review all extracted fields before creating a customer from intake data.')
      return
    }
    if (customerForm.name.trim().length < 2 || customerForm.code.trim().length < 2) {
      setError('Enter a customer name and customer code of at least two characters.')
      return
    }

    setSavingCustomer(true)
    setError('')
    try {
      const response = await api.post('/customers', {
        name: customerForm.name.trim(),
        code: customerForm.code.trim(),
        email: customerForm.email.trim(),
        phone: customerForm.phone.trim(),
        address: customerForm.address.trim(),
        gstNumber: customerForm.gstNumber.trim(),
      })
      const customer = response.data.data as Customer
      await refreshCustomers()
      setCustomerId(customer.id)
      setCustomerName(customer.name)
      setCustomerSearch('')
      setShowCustomerForm(false)
      setSuccess('Customer created and selected. Confirm the RFQ details before creating the RFQ.')
    } catch (requestError) {
      setError(message(requestError))
    } finally {
      setSavingCustomer(false)
    }
  }

  return (
    <section className="intake-page">
      <div className="intake-heading">
        <div>
          <span className="intake-eyebrow">DOCUMENT PROCESSING</span>
          <h1>RFQ Intake</h1>
          <p>Upload documents, review evidence-backed values, and create every reviewed part together.</p>
        </div>
        <div className="intake-supported">
          <span><FileText size={15} /> PDF drawings</span>
          <span><FileSpreadsheet size={15} /> XLSX sheets</span>
          <span><Mail size={15} /> EML emails</span>
        </div>
      </div>
      {error && <div className="intake-alert intake-error"><AlertCircle size={17} /><span>{error}</span></div>}
      {success && <div className="intake-alert intake-success"><CheckCircle2 size={17} /><span>{success}</span></div>}

      <div className="intake-upload-card">
        <div className="intake-upload-icon"><Upload size={24} /></div>
        <h2>Upload customer RFQ documents</h2>
        <p>Choose customer RFQ emails, PDF drawings, or XLSX requirement sheets.</p>
        <input ref={input} type="file" multiple hidden
          accept=".pdf,.xlsx,.eml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,message/rfc822"
          onChange={(event) => void upload(event.target.files)} />
        <button type="button" className="intake-primary-button" disabled={loading} onClick={() => input.current?.click()}>
          {loading ? <LoaderCircle className="intake-spin" size={17} /> : <Upload size={17} />}
          {loading ? 'Processing documents...' : 'Choose documents'}
        </button>
        <span className="intake-file-note">EML, PDF, or XLSX - Up to 10 MB per file - Maximum 10 files. Email attachments are retained but must be uploaded separately. Legacy .xls is not supported.</span>
        <p>Review progress is kept while navigating this workspace. Save reviews before closing or reloading; re-uploading an unlinked document restores its saved reviews.</p>
      </div>

      {failedUploads.map((item) => <div className="intake-form-card" key={item.id}>
        <strong>{item.file.name} — upload failed</strong><p>{item.message}</p>
        <div className="intake-actions">
          <button type="button" disabled={loading} className="intake-secondary-button" onClick={() => void upload([item.file], item.id)}>Retry upload</button>
          <button type="button" disabled={loading} className="intake-secondary-button" onClick={() => setFailedUploads((current) => current.filter((entry) => entry.id !== item.id))}>Remove from intake</button>
        </div>
      </div>)}

      {jobs.map((job) => (
        <div className="intake-job-card" key={job.id}>
          <div className="intake-job-file">
            {job.attachment?.fileName.toLowerCase().endsWith('.eml') ? <Mail size={21} /> : job.attachment?.mimeType === 'application/pdf' ? <FileText size={21} /> : <FileSpreadsheet size={21} />}
            <div><strong>{job.attachment?.fileName || 'Uploaded document'}</strong><span>Extraction job - {job.id}</span>
              {job.errorMessage && <p role="status">{job.errorMessage}</p>}</div>
          </div>
          <div className="intake-actions">
            <span className={'intake-status ' + job.status.toLowerCase()}>{job.status}</span>
            {job.status === 'FAILED' && <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || loading} onClick={() => void retry(job.id)}>
              {saving === job.id ? <LoaderCircle className="intake-spin" size={15} /> : <RotateCcw size={15} />} Retry extraction
            </button>}
            <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || loading || creating} onClick={() => setJobs((current) => current.filter((item) => item.id !== job.id))}>Remove from intake</button>
          </div>
        </div>
      ))}

      {completedJobs.map((job) => {
        const jobGroups = Array.from(new Set(job.fields.map((field) => groupId(job.id, field))))
        return <section key={'review-' + job.id}>
          <div className="intake-section-heading">
            <div><span className="intake-eyebrow">EXTRACTION REVIEW</span><h2>Review {job.attachment?.fileName || 'document'}</h2>
              <p>Every suggestion requires review. Confidence indicates source uncertainty, not a calibrated probability; check each value against its evidence.</p></div>
            <span className="intake-field-count">{job.fields.length} fields found</span>
          </div>
          {!job.fields.length && <div className="intake-empty"><AlertCircle size={22} /><strong>No labelled fields were extracted.</strong><p>Add missing part details below; the attachment can still be linked.</p></div>}
          {jobGroups.map((group) => <div className="intake-form-card" key={job.id + ':' + group}>
            <div className="intake-section-heading compact"><div><h2>{groupLabel(group)}</h2><p>Review this source group independently. Reject conflicting candidates before creation.</p></div></div>
            <div className="intake-fields">{job.fields.filter((field) => groupId(job.id, field) === group).map((field) => {
              const isSaving = saving === field.id
              const dirty = field.reviewStatus === 'ACCEPTED' && (values[field.id] || '').trim() !== field.acceptedValue
              return <div className="intake-field" key={field.id}>
                <div className="intake-field-top"><label htmlFor={'field-' + field.id}>{labels[field.fieldName] || field.fieldName}</label>
                  <span className="intake-confidence">{confidenceLabel(field.confidence)}</span></div>
                <span>{field.reviewStatus}{dirty ? ' — unsaved edit; draft still uses the saved review' : ''}</span>
                <input id={'field-' + field.id} value={values[field.id] || ''} disabled={Boolean(saving) || creating}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))} />
                <div className="intake-field-source">
                  <span>{field.sourceReference || 'Source reference unavailable'}</span>
                  <span>{field.sourceId ? 'Source ID: ' + field.sourceId : 'Source ID unavailable'}</span>
                  <span>{field.evidenceText ? 'Evidence: ' + field.evidenceText : 'Literal evidence unavailable'}</span>
                  <span>{field.extractionMethod || 'Extraction method unavailable'}</span>
                </div>
                <div className="intake-actions">
                  {field.reviewStatus !== 'REJECTED' && <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || creating} onClick={() => void review(job.id, field, 'ACCEPTED')}>
                    {isSaving ? <LoaderCircle className="intake-spin" size={15} /> : <CheckCircle2 size={15} />}
                    {field.reviewStatus === 'ACCEPTED' ? 'Save edit' : 'Accept'}
                  </button>}
                  {field.reviewStatus !== 'REJECTED' && <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || creating} onClick={() => void review(job.id, field, 'REJECTED')}>
                    <XCircle size={15} /> Reject
                  </button>}
                  {field.reviewStatus === 'REJECTED' && <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || creating} onClick={() => void review(job.id, field, 'ACCEPTED')}>
                    <CheckCircle2 size={15} /> Accept instead
                  </button>}
                  <button type="button" className="intake-secondary-button" disabled={Boolean(saving) || creating} onClick={() => void review(job.id, field, 'REJECTED', true)}>Mark unavailable (reject)</button>
                </div>
              </div>
            })}</div>
          </div>)}
        </section>
      })}

      {jobs.length > 0 && <div className="intake-form-card">
        <div className="intake-section-heading compact"><div><span className="intake-eyebrow">RFQ CREATION</span><h2>Confirm RFQ and parts</h2>
          <p>Accepted values populate fields below; add manual values for missing information.</p></div></div>
        {(dirtyReviews || conflicts) && <p role="alert">{dirtyReviews ? 'Save or reject all unsaved review edits. ' : ''}{conflicts ? 'Conflicting accepted values exist. Reject or correct them in source review.' : ''}</p>}
        <div className="intake-form-grid">
          <label>RFQ number<input value={rfqNumber} onChange={(event) => setRfqNumber(event.target.value)} /></label>
          <label>Customer name<input value={customerName} onChange={(event) => { setCustomerName(event.target.value); setCustomerId('') }} /></label>
          <label>Search registered customers<input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Name or customer code" /></label>
          <label>Confirmed customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={customersLoading}>
            <option value="">Select the correct customer</option>{visibleCustomers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} ({customer.code})</option>)}
          </select></label>
          <label>Received date<input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} /></label>
          <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          <label className="intake-notes">Estimator notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        </div>
        <div className="intake-customer-match">
          <button type="button" className="intake-secondary-button" disabled={customersLoading} onClick={() => void refreshCustomers().catch(() => setError('Could not refresh customers.'))}>Refresh customers</button>
          {customersLoading ? <span><LoaderCircle className="intake-spin" size={14} /> Refreshing customer directory...</span> : exactMatches.length > 0 ? (
            <span><CheckCircle2 size={15} /> Exact match found: {exactMatches.map((customer) => `${customer.name} (${customer.code})`).join(', ')}. Select it above to confirm.</span>
          ) : customerName.trim() ? (
            <span><AlertCircle size={15} /> No exact customer name or code match was found. Do not select an unrelated customer.</span>
          ) : <span>Enter a reviewed customer name, then explicitly select the correct registered customer.</span>}
          {canManageCustomers ? (
            <button type="button" className="intake-secondary-button" disabled={!allJobsCompleted || !allReviewed || savingCustomer || dirtyReviews || conflicts || Boolean(saving) || loading} onClick={openCustomerForm}>
              <Plus size={15} /> Add verified customer
            </button>
          ) : (
            <small>Only administrators can create customer records. Ask an administrator to add a verified record if no match exists.</small>
          )}
        </div>
        {groups.map((group) => {
          const current = draft(group)
          const field = (key: keyof Draft, label: string) => {
            const fromReview = Boolean(savedValue(fields, key === 'name' ? 'partName' : key, group))
            return <label key={key}>{label}{fromReview ? ' (saved review)' : ''}<input value={current[key]} readOnly={fromReview} title={fromReview ? 'Correct this value in source review above, then save.' : undefined} onChange={(event) => updateDraft(group, key, event.target.value)} /></label>
          }
          return <div className="intake-form-card" key={'part-' + group}>
            <div className="intake-section-heading compact"><div><h2>{sourceDocument(group)} {groupLabel(group)}</h2><p>Complete missing or rejected values manually. Ambiguous weights and quantities never fill kilograms or annual volume.</p></div>
              <button type="button" className="intake-secondary-button" onClick={() => {
                setExcludedGroups((current) => [...current, group])
                setManualGroups((currentGroups) => currentGroups.filter((key) => key !== group))
                setDrafts((currentDrafts) => { const next = { ...currentDrafts }; delete next[group]; return next })
              }}>Exclude part group</button>
            </div>
            <div className="intake-form-grid">
              {field('partNumber', 'Part number')}{field('name', 'Part name *')}{field('materialGrade', 'Material grade')}
              {field('grossWeightKg', 'Gross weight (kg)')}{field('annualVolume', 'Annual volume')}{field('drawingNumber', 'Drawing number')}{field('revision', 'Drawing revision')}
            </div>
          </div>
        })}
        {excludedGroups.filter((group) => sourceGroups.includes(group)).map((group) => <p key={group}>
          Excluded: {sourceDocument(group)} {groupLabel(group)} <button type="button" onClick={() => setExcludedGroups((current) => current.filter((key) => key !== group))}>Restore group</button>
        </p>)}
        <label><input type="checkbox" checked={confirmed} disabled={!allReviewed || !allJobsCompleted || dirtyReviews || conflicts || Boolean(saving) || loading}
          onChange={(event) => setConfirmedSignature(event.target.checked ? signature : '')} /> I verified the selected customer, part groups, units and annual volumes against the documents.</label>
        <div className="intake-actions">
          <button type="button" className="intake-secondary-button" onClick={() => {
            const group = 'manual:' + crypto.randomUUID(); setManualGroups((current) => [...current, group])
            setDrafts((current) => ({ ...current, [group]: emptyDraft() }))
          }}>Add manual part</button>
          <button type="button" className="intake-primary-button" disabled={creating || loading || Boolean(saving) || !allReviewed || !allJobsCompleted || dirtyReviews || conflicts || !confirmed} onClick={() => void create()}>
            {creating ? <LoaderCircle className="intake-spin" size={16} /> : <ArrowRight size={16} />}
            {creating ? 'Creating RFQ...' : 'Create RFQ with all parts'}
          </button>
        </div>
      </div>}

      {showCustomerForm && (
        <div className="intake-customer-modal-backdrop">
          <section className="intake-customer-modal">
            <div className="intake-section-heading compact"><div><span className="intake-eyebrow">VERIFIED CUSTOMER</span><h2>Add customer</h2><p>Confirm all details before saving. Nothing is created from extraction data automatically.</p></div>
              <button type="button" className="intake-secondary-button" disabled={savingCustomer} onClick={() => setShowCustomerForm(false)}>Close</button>
            </div>
            <div className="intake-form-grid">
              <label>Customer name *<input value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} /></label>
              <label>Customer code *<input value={customerForm.code} onChange={(event) => setCustomerForm((current) => ({ ...current, code: event.target.value }))} pattern="[A-Za-z0-9_-]+" /></label>
              <label>Email<input type="email" value={customerForm.email} onChange={(event) => setCustomerForm((current) => ({ ...current, email: event.target.value }))} /></label>
              <label>Phone<input value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label>GSTIN<input value={customerForm.gstNumber} onChange={(event) => setCustomerForm((current) => ({ ...current, gstNumber: event.target.value }))} /></label>
              <label className="intake-notes">Address<textarea rows={3} value={customerForm.address} onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))} /></label>
            </div>
            <div className="intake-actions"><button type="button" className="intake-primary-button" disabled={savingCustomer} onClick={() => void createCustomer()}>
              {savingCustomer ? <LoaderCircle className="intake-spin" size={16} /> : <Plus size={16} />}{savingCustomer ? 'Creating customer...' : 'Create and select customer'}
            </button></div>
          </section>
        </div>
      )}
    </section>
  )
}
