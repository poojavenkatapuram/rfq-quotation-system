
import { useCallback, useEffect, useState } from 'react'
import {
  Search,
  Plus,
  RefreshCw,
  X,
  ChevronLeft,
  ChevronRight,
  Eye,
  ClipboardList,
  LoaderCircle,
  AlertCircle,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
import './RFQRegister.css'
import { manualRFQStatuses } from './rfq-lifecycle'

type User = {
  id: string
  name: string
  email: string
  role: string
}

type Customer = {
  id: string
  name: string
  code: string
}

type Part = {
  id: string
  partNumber?: string | null
  name: string
  materialGrade?: string | null
  grossWeightKg?: string | number | null
  annualVolume?: number | null
  drawingNumber?: string | null
}

type RFQ = {
  id: string
  rfqNumber: string
  status: string
  receivedDate: string
  updatedAt: string
  assignedToId?: string | null
  dueDate?: string | null
  notes?: string | null
  lostReason?: string | null
  customer: Customer
  assignedTo?: User | null
  parts: Part[]
  _count?: {
    quotations: number
  }
}

type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

type PartForm = {
  partNumber: string
  name: string
  materialGrade: string
  grossWeightKg: string
  annualVolume: string
  drawingNumber: string
}

const emptyPart = (): PartForm => ({
  partNumber: '',
  name: '',
  materialGrade: '',
  grossWeightKg: '',
  annualVolume: '',
  drawingNumber: '',
})

const statuses = [
  'RECEIVED',
  'ESTIMATING',
  'PENDING_APPROVAL',
  'QUOTATION_SENT',
  'WON',
  'LOST',
]

const statusLabels: Record<string, string> = {
  RECEIVED: 'Received',
  ESTIMATING: 'Estimating',
  PENDING_APPROVAL: 'Pending approval',
  QUOTATION_SENT: 'Quotation sent',
  WON: 'Won',
  LOST: 'Lost',
}

function formatDate(value?: string | null) {
  if (!value) return 'Not set'

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error
  ) {
    const response = (error as {
      response?: { data?: { message?: string } }
    }).response

    if (response?.data?.message) return response.data.message
  }

  return 'Something went wrong. Please try again.'
}

const fetchCustomers = async (): Promise<Customer[]> => {
  const response = await api.get('/customers')
  return response.data.data
}

export default function RFQRegister() {
  const { token, user } = useAuth()
  const canAssign = ['ADMIN', 'ESTIMATOR'].includes(user?.role ?? '')
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string }>>([])
  const [ownersLoading, setOwnersLoading] = useState(false)
  const [ownerError, setOwnerError] = useState('')
  const [updatingRFQId, setUpdatingRFQId] = useState('')

  const loadAssignees = useCallback(async () => {
    setOwnersLoading(true); setOwnerError('')
    try { const response = await api.get('/rfqs/assignees'); setAssignees(response.data.data) }
    catch { setOwnerError('RFQ owners could not be loaded. Retry before assigning an owner.') }
    finally { setOwnersLoading(false) }
  }, [])

  useEffect(() => {
    if (!canAssign || !token) return
    const timer = window.setTimeout(() => { void loadAssignees() }, 0)
    return () => window.clearTimeout(timer)
  }, [canAssign, token, loadAssignees])

  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  })

  const [search, setSearch] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [selectedRFQ, setSelectedRFQ] = useState<RFQ | null>(null)
  const [createLoading, setCreateLoading] = useState(false)

  const [form, setForm] = useState({
    rfqNumber: '',
    customerId: '',
    assignedToId: '',
    receivedDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    notes: '',
  })

  const [parts, setParts] = useState<PartForm[]>([emptyPart()])

  const fetchRFQs = useCallback(async (page = 1) => {
    const response = await api.get('/rfqs', {
      params: {
        page,
        limit: 10,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
      },
    })

    return {
      rfqs: response.data.data as RFQ[],
      pagination: response.data.pagination as Pagination,
    }
  }, [search, statusFilter])

  const loadRFQs = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')

    try {
      const data = await fetchRFQs(page)
      setRfqs(data.rfqs)
      setPagination(data.pagination)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }, [fetchRFQs])

  useEffect(() => {
    if (!token) return

    let isCurrent = true

    const loadInitialRFQs = async () => {
      try {
        const [rfqData, customerData] = await Promise.all([
          fetchRFQs(1),
          fetchCustomers(),
        ])

        if (!isCurrent) return

        setRfqs(rfqData.rfqs)
        setPagination(rfqData.pagination)
        setCustomers(customerData)
      } catch (error) {
        if (isCurrent) setError(getErrorMessage(error))
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialRFQs()

    return () => {
      isCurrent = false
    }
  }, [token, fetchRFQs])

  const updatePart = (
    index: number,
    field: keyof PartForm,
    value: string,
  ) => {
    setParts((current) =>
      current.map((part, partIndex) =>
        partIndex === index ? { ...part, [field]: value } : part,
      ),
    )
  }

  const visibleCustomers = customers.filter((customer) => {
    const query = customerSearch.trim().toLowerCase()
    return !query ||
      customer.name.toLowerCase().includes(query) ||
      customer.code.toLowerCase().includes(query)
  })

  const handleCreate = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    if (!form.customerId) {
      setError('Please select a customer.')
      return
    }

    if (parts.some((part) => !part.name.trim())) {
      setError('Every part must have a name.')
      return
    }

    setCreateLoading(true)

    try {
      const payload = {
        rfqNumber: form.rfqNumber.trim(),
        customerId: form.customerId,
        assignedToId: form.assignedToId || undefined,
        receivedDate: form.receivedDate || undefined,
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined,
        parts: parts.map((part) => ({
          partNumber: part.partNumber.trim() || undefined,
          name: part.name.trim(),
          materialGrade: part.materialGrade.trim() || undefined,
          grossWeightKg: part.grossWeightKg
            ? Number(part.grossWeightKg)
            : undefined,
          annualVolume: part.annualVolume
            ? Number(part.annualVolume)
            : undefined,
          drawingNumber: part.drawingNumber.trim() || undefined,
        })),
      }

      await api.post('/rfqs', payload)

      setShowCreate(false)

      setForm({
        rfqNumber: '',
        customerId: '',
        assignedToId: '',
        receivedDate: new Date().toISOString().slice(0, 10),
        dueDate: '',
        notes: '',
      })

      setParts([emptyPart()])
      setSuccess('RFQ created successfully.')

      await loadRFQs(1)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setCreateLoading(false)
    }
  }

  const openDetails = async (rfq: RFQ) => {
    setError('')

    try {
      const response = await api.get(`/rfqs/${rfq.id}`)
      setSelectedRFQ(response.data.data)
      setShowDetails(true)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  const updateStatus = async (rfq: RFQ, status: string) => {
    if (!manualRFQStatuses(rfq.status, user?.role).includes(status) || updatingRFQId) return
    setError('')
    setSuccess('')

    let lostReason: string | undefined

    if (status === 'LOST') {
      lostReason =
        window.prompt('Enter the reason for losing this RFQ:') || ''

      if (lostReason.trim().length < 2) {
        setError('A reason is required to mark an RFQ as lost.')
        return
      }
    }

    setUpdatingRFQId(rfq.id)
    try {
      await api.patch(`/rfqs/${rfq.id}`, {
        expectedUpdatedAt: rfq.updatedAt,
        status,
        ...(status === 'LOST' ? { lostReason } : {}),
      })

      setSuccess(`${rfq.rfqNumber} status updated.`)
      await loadRFQs(pagination.page)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally { setUpdatingRFQId('') }
  }

  const updateOwner = async (rfq: RFQ, assignedToId: string) => {
    if (!canAssign || updatingRFQId) return
    setUpdatingRFQId(rfq.id); setError(''); setSuccess('')
    try {
      await api.patch(`/rfqs/${rfq.id}`, { assignedToId: assignedToId || null, expectedUpdatedAt: rfq.updatedAt })
      await loadRFQs(pagination.page)
      setSuccess(`${rfq.rfqNumber} owner updated.`)
    } catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setUpdatingRFQId('') }
  }

  return (
    <section className="rfq-page">
      <div className="rfq-page-heading">
        <div>
          <span className="rfq-eyebrow">
            WORKSPACE / SALES OPERATIONS
          </span>
          <h1>RFQ Register</h1>
          <p>
            Track incoming requests, customers, parts and deadlines.
          </p>
        </div>

        <div className="rfq-heading-actions">
          {canAssign && <button
            className="rfq-primary-button"
            onClick={() => {
              setError('')
              setSuccess('')
              setCustomerSearch('')
              setShowCreate(true)
            }}
          >
            <Plus size={17} /> New RFQ
          </button>}
        </div>
      </div>

      <div className="rfq-summary-grid">
        <div className="rfq-summary-card">
          <span>Total matching RFQs</span>
          <strong>{pagination.total}</strong>
        </div>

        <div className="rfq-summary-card">
          <span>On this page</span>
          <strong>{rfqs.length}</strong>
        </div>

        <div className="rfq-summary-card">
          <span>Current page</span>
          <strong>
            {pagination.totalPages
              ? `${pagination.page} / ${pagination.totalPages}`
              : '0'}
          </strong>
        </div>
      </div>

      {canAssign && ownerError && <div className="rfq-alert error" role="alert">{ownerError} <button type="button" disabled={ownersLoading} onClick={() => void loadAssignees()}>Retry owner lookup</button></div>}
      <p className="rfq-lifecycle-help">Pending approval and Quotation sent are updated by the quotation workflow. Refresh the register after quotation actions.</p>
      {error && (
        <div className="rfq-alert error">
          <AlertCircle size={17} /> {error}
          <button
            onClick={() => setError('')}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {success && (
        <div className="rfq-alert success">
          {success}
          <button
            onClick={() => setSuccess('')}
            aria-label="Dismiss message"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="rfq-toolbar">
        <div className="rfq-search">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setLoading(true)
              setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadRFQs(1)
            }}
            placeholder="Search RFQ, customer or part..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value)
            setLoading(true)
            setError('')
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>

        <button
          className="rfq-secondary-button"
          onClick={() => void loadRFQs(1)}
          disabled={loading}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="rfq-table-card">
        <div className="rfq-table-heading">
          <div>
            <h2>Incoming requests</h2>
            <p>Live records retrieved from the RFQ database.</p>
          </div>
          <span>{pagination.total} records</span>
        </div>

        <div className="rfq-table-scroll">
          <table className="rfq-table">
            <thead>
              <tr>
                <th>RFQ number</th>
                <th>Customer</th>
                <th>Parts</th>
                <th>Received</th>
                <th>Due date</th>
                <th>Assigned to</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="rfq-empty">
                    <LoaderCircle className="rfq-spin" size={22} />
                    Loading RFQs...
                  </td>
                </tr>
              ) : rfqs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="rfq-empty">
                    <ClipboardList size={24} />
                    <strong>No RFQs found</strong>
                    <span>
                      Create an RFQ or change your search filters.
                    </span>
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq) => (
                  <tr key={rfq.id}>
                    <td>
                      <strong className="rfq-number">
                        {rfq.rfqNumber}
                      </strong>
                    </td>

                    <td>
                      <strong>
                        {rfq.customer?.name || 'Unknown customer'}
                      </strong>
                      <small>{rfq.customer?.code || ''}</small>
                    </td>

                    <td>
                      <strong>{rfq.parts.length} part(s)</strong>
                      <small>
                        {rfq.parts[0]?.name || 'No part name'}
                      </small>
                    </td>

                    <td>{formatDate(rfq.receivedDate)}</td>
                    <td>{formatDate(rfq.dueDate)}</td>
                    <td>{canAssign ? <select className="rfq-owner-select" aria-label={`Owner for ${rfq.rfqNumber}`}
                      value={rfq.assignedToId ?? rfq.assignedTo?.id ?? ''} disabled={ownersLoading || Boolean(ownerError) || Boolean(updatingRFQId)}
                      onChange={event => void updateOwner(rfq, event.target.value)}>
                      <option value="">Unassigned</option>
                      {rfq.assignedTo && !assignees.some(owner => owner.id === rfq.assignedTo!.id) && <option value={rfq.assignedTo.id}>{rfq.assignedTo.name} (current owner)</option>}
                      {assignees.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                    </select> : rfq.assignedTo?.name || 'Unassigned'}</td>

                    <td>
                      <select
                        className={`rfq-status-select status-${rfq.status.toLowerCase()}`}
                        value={rfq.status}
                        disabled={Boolean(updatingRFQId) || manualRFQStatuses(rfq.status, user?.role).length === 0}
                        onChange={(event) =>
                          void updateStatus(rfq, event.target.value)
                        }
                        aria-label={`Change status for ${rfq.rfqNumber}`}
                      >
                        {[rfq.status, ...manualRFQStatuses(rfq.status, user?.role)].map((status) => (
                          <option key={status} value={status}>
                            {statusLabels[status]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <button
                        className="rfq-icon-button"
                        onClick={() => void openDetails(rfq)}
                        aria-label={`View ${rfq.rfqNumber}`}
                        title="View details"
                      >
                        <Eye size={17} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rfq-pagination">
          <span>
            Showing{' '}
            {rfqs.length
              ? (pagination.page - 1) * pagination.limit + 1
              : 0}
            {' '}to {(pagination.page - 1) * pagination.limit + rfqs.length}
            {' '}of {pagination.total}
          </span>

          <div>
            <button
              className="rfq-icon-button"
              disabled={pagination.page <= 1 || loading}
              onClick={() => void loadRFQs(pagination.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={18} />
            </button>

            <span>
              Page {pagination.page} of{' '}
              {Math.max(1, pagination.totalPages)}
            </span>

            <button
              className="rfq-icon-button"
              disabled={
                pagination.page >= pagination.totalPages || loading
              }
              onClick={() => void loadRFQs(pagination.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="rfq-modal-backdrop">
          <form className="rfq-modal" onSubmit={handleCreate}>
            <div className="rfq-modal-heading">
              <div>
                <span className="rfq-eyebrow">RFQ MANAGEMENT</span>
                <h2>Create new RFQ</h2>
              </div>

              <button
                type="button"
                className="rfq-icon-button"
                onClick={() => setShowCreate(false)}
                aria-label="Close form"
              >
                <X size={19} />
              </button>
            </div>

            <div className="rfq-form-grid">
              <label>
                RFQ number *
                <input
                  value={form.rfqNumber}
                  onChange={(event) =>
                    setForm({ ...form, rfqNumber: event.target.value })
                  }
                  placeholder="RFQ-2611-028"
                  minLength={3}
                  maxLength={50}
                  required
                />
              </label>

              <label>
                Search customers
                <input
                  value={customerSearch}
                  onChange={(event) => setCustomerSearch(event.target.value)}
                  placeholder="Name or customer code"
                />
              </label>

              <label>
                Customer *
                <select
                  value={form.customerId}
                  onChange={(event) =>
                    setForm({ ...form, customerId: event.target.value })
                  }
                  required
                >
                  <option value="">Select customer</option>
                  {visibleCustomers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} ({customer.code})
                    </option>
                  ))}
                </select>
              </label>

              <label>RFQ owner (optional)
                <select value={form.assignedToId} disabled={ownersLoading || Boolean(ownerError)} onChange={event => setForm({ ...form, assignedToId: event.target.value })}>
                  <option value="">Unassigned</option>
                  {assignees.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
              </label>

              <label>
                Received date
                <input
                  type="date"
                  value={form.receivedDate}
                  onChange={(event) =>
                    setForm({ ...form, receivedDate: event.target.value })
                  }
                />
              </label>

              <label>
                Due date
                <input
                  type="date"
                  value={form.dueDate}
                  min={form.receivedDate}
                  onChange={(event) =>
                    setForm({ ...form, dueDate: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="rfq-parts-heading">
              <div>
                <h3>Part details</h3>
                <p>Add one or more parts to this RFQ.</p>
              </div>

              <button
                type="button"
                className="rfq-secondary-button"
                onClick={() => setParts([...parts, emptyPart()])}
              >
                <Plus size={15} /> Add part
              </button>
            </div>

            {parts.map((part, index) => (
              <div className="rfq-part-form" key={index}>
                <div className="rfq-part-form-heading">
                  <strong>Part {index + 1}</strong>

                  {parts.length > 1 && (
                    <button
                      type="button"
                      className="rfq-remove-button"
                      onClick={() =>
                        setParts(parts.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="rfq-form-grid">
                  <label>
                    Part name *
                    <input
                      value={part.name}
                      onChange={(event) =>
                        updatePart(index, 'name', event.target.value)
                      }
                      placeholder="Rear wheel spindle"
                      required
                    />
                  </label>

                  <label>
                    Part number
                    <input
                      value={part.partNumber}
                      onChange={(event) =>
                        updatePart(index, 'partNumber', event.target.value)
                      }
                      placeholder="PART-001"
                    />
                  </label>

                  <label>
                    Material grade
                    <input
                      value={part.materialGrade}
                      onChange={(event) =>
                        updatePart(index, 'materialGrade', event.target.value)
                      }
                      placeholder="EN8"
                    />
                  </label>

                  <label>
                    Gross weight (kg)
                    <input
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={part.grossWeightKg}
                      onChange={(event) =>
                        updatePart(index, 'grossWeightKg', event.target.value)
                      }
                      placeholder="0.6100"
                    />
                  </label>

                  <label>
                    Annual volume
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={part.annualVolume}
                      onChange={(event) =>
                        updatePart(index, 'annualVolume', event.target.value)
                      }
                      placeholder="180000"
                    />
                  </label>

                  <label>
                    Drawing number
                    <input
                      value={part.drawingNumber}
                      onChange={(event) =>
                        updatePart(index, 'drawingNumber', event.target.value)
                      }
                      placeholder="DWG-001"
                    />
                  </label>
                </div>
              </div>
            ))}

            <label className="rfq-notes-label">
              Notes
              <textarea
                rows={3}
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
                placeholder="Additional RFQ information..."
              />
            </label>

            <div className="rfq-modal-footer">
              <button
                type="button"
                className="rfq-secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>

              <button
                className="rfq-primary-button"
                disabled={createLoading}
              >
                {createLoading ? 'Creating...' : 'Create RFQ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showDetails && selectedRFQ && (
        <div className="rfq-modal-backdrop">
          <section className="rfq-modal rfq-details-modal">
            <div className="rfq-modal-heading">
              <div>
                <span className="rfq-eyebrow">RFQ DETAILS</span>
                <h2>{selectedRFQ.rfqNumber}</h2>
              </div>

              <button
                className="rfq-icon-button"
                onClick={() => setShowDetails(false)}
                aria-label="Close details"
              >
                <X size={19} />
              </button>
            </div>

            <div className="rfq-detail-grid">
              <div>
                <span>Customer</span>
                <strong>{selectedRFQ.customer?.name}</strong>
              </div>

              <div>
                <span>Status</span>
                <strong>
                  {statusLabels[selectedRFQ.status] || selectedRFQ.status}
                </strong>
              </div>

              <div>
                <span>Received</span>
                <strong>{formatDate(selectedRFQ.receivedDate)}</strong>
              </div>

              <div>
                <span>Due date</span>
                <strong>{formatDate(selectedRFQ.dueDate)}</strong>
              </div>

              <div>
                <span>Assigned estimator</span>
                <strong>
                  {selectedRFQ.assignedTo?.name || 'Unassigned'}
                </strong>
              </div>

              <div>
                <span>Quotations</span>
                <strong>{selectedRFQ._count?.quotations ?? 0}</strong>
              </div>
            </div>

            <h3>Parts ({selectedRFQ.parts.length})</h3>

            <div className="rfq-detail-parts">
              {selectedRFQ.parts.map((part) => (
                <div key={part.id}>
                  <strong>{part.name}</strong>

                  <span>
                    {part.partNumber || 'No part number'} ·{' '}
                    {part.materialGrade || 'Material not specified'}
                  </span>

                  <span>
                    Weight: {part.grossWeightKg ?? '—'} kg · Annual volume:{' '}
                    {part.annualVolume?.toLocaleString('en-IN') ?? '—'}
                  </span>
                </div>
              ))}
            </div>

            {selectedRFQ.notes && (
              <div className="rfq-detail-notes">
                <span>Notes</span>
                <p>{selectedRFQ.notes}</p>
              </div>
            )}

            {selectedRFQ.lostReason && (
              <div className="rfq-detail-notes">
                <span>Lost reason</span>
                <p>{selectedRFQ.lostReason}</p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
