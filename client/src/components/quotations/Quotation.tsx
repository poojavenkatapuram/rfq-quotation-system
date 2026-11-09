import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  FileText, Plus, RefreshCw, Search, Eye, Printer,
  Send, CheckCircle, XCircle, Clock, X, AlertCircle,
} from 'lucide-react'
import api from '../../services/api'
import './Quotation.css'

type ApiResponse = { data?: unknown }

type QuotationPart = {
  id: string
  partId?: string
  partNumber?: string | null
  partName?: string | null
  name?: string | null
  description?: string | null
  materialGrade?: string | null
  quantity?: number | string
  unitPrice?: number | string
  totalPrice?: number | string
  part?: {
    partNumber?: string | null
    partName?: string | null
  }
}

type CostingVolume = {
  annualVolume?: number | string
  quantity?: number | string
  unitPrice?: number | string
}

type CostingOption = {
  id: string
  version?: number | string
  createdAt?: string
  volumes?: CostingVolume[] | Record<string, CostingVolume | number | string>
}

const isCostingVolume = (
  value: CostingVolume | number | string,
): value is CostingVolume => typeof value === 'object' && value !== null

type RFQ = {
  id: string
  rfqNumber?: string
  customer?: { name?: string }
  parts?: QuotationPart[]
}

type Quotation = {
  id: string
  quotationNumber?: string
  customer?: { name?: string }
  rfq?: { rfqNumber?: string }
  createdAt?: string
  grandTotal?: number | string
  subtotal?: number | string
  gstAmount?: number | string
  validUntil?: string | null
  status?: string
  notes?: string | null
  paymentTerms?: string | null
  deliveryTerms?: string | null
  commercialTerms?: string | null
  parts?: QuotationPart[]
}

type StoredUser = { role?: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const getErrorMessage = (error: unknown, fallback: string) =>
  axios.isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || fallback
    : fallback

const money = (value: number | string | null | undefined) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const getList = <T,>(response: ApiResponse): T[] => {
  const body = response.data
  if (Array.isArray(body)) return body as T[]
  if (!isRecord(body)) return []

  if (Array.isArray(body.data)) return body.data as T[]
  if (isRecord(body.data) && Array.isArray(body.data.data)) {
    return body.data.data as T[]
  }
  if (Array.isArray(body.quotations)) return body.quotations as T[]

  return []
}

const getObject = <T,>(response: ApiResponse): T => {
  const body = response.data
  if (isRecord(body) && 'data' in body) return body.data as T
  return (body ?? {}) as T
}

const getStoredUser = (): StoredUser => {
  try {
    const user: unknown = JSON.parse(localStorage.getItem('rfq_user') || '{}')
    return isRecord(user) && typeof user.role === 'string'
      ? { role: user.role }
      : {}
  } catch {
    return {}
  }
}

const fetchQuotationData = async () => {
  const [quotationResponse, rfqResponse] = await Promise.all([
    api.get('/quotations?page=1&limit=100'),
    api.get('/rfqs?limit=100'),
  ])

  return {
    quotations: getList<Quotation>(quotationResponse),
    rfqs: getList<RFQ>(rfqResponse),
  }
}

const statusLabel = (status = '') =>
  status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

const statusClass = (status = '') => status.toLowerCase().replaceAll('_', '-')

export default function Quotation() {
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [rfqs, setRfqs] = useState<RFQ[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null)
  const [selectedRFQ, setSelectedRFQ] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [gstPercentage, setGstPercentage] = useState('18')
  const [notes, setNotes] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [commercialTerms, setCommercialTerms] = useState('')
  const [costingOptions, setCostingOptions] = useState<Record<string, CostingOption[]>>({})
  const [selectedCostings, setSelectedCostings] = useState<Record<string, string>>({})
  const [selectedVolumes, setSelectedVolumes] = useState<Record<string, string>>({})
  const [loadingCostings, setLoadingCostings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionId, setActionId] = useState('')
  const [actionError, setActionError] = useState('')

  const user = useMemo(() => getStoredUser(), [])

  const role = String(user?.role || '').toUpperCase()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchQuotationData()
      setQuotations(data.quotations)
      setRfqs(data.rfqs)
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to load quotations. Please check your login and server connection.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadInitialQuotations = async () => {
      try {
        const data = await fetchQuotationData()
        if (!isCurrent) return

        setQuotations(data.quotations)
        setRfqs(data.rfqs)
      } catch (error) {
        if (isCurrent) {
          setError(getErrorMessage(error, 'Unable to load quotations. Please check your login and server connection.'))
        }
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialQuotations()

    return () => {
      isCurrent = false
    }
  }, [])

  const filteredQuotations = useMemo(() => {
    return quotations.filter((quotation) => {
      const matchesSearch =
        `${quotation.quotationNumber || ''} ${quotation.customer?.name || ''} ${quotation.rfq?.rfqNumber || ''}`
          .toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === 'ALL' || quotation.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [quotations, search, statusFilter])

  const chosenRFQ = rfqs.find((rfq) => rfq.id === selectedRFQ)
  const parts = chosenRFQ?.parts ?? []

  const openCreate = () => {
    setSelectedRFQ('')
    setValidUntil('')
    setGstPercentage('18')
    setNotes('')
    setPaymentTerms('')
    setDeliveryTerms('')
    setCommercialTerms('')
    setCostingOptions({})
    setSelectedCostings({})
    setSelectedVolumes({})
    setActionError('')
    setShowCreate(true)
  }

  const loadCostings = async (rfqId: string) => {
    setSelectedRFQ(rfqId)
    setCostingOptions({})
    setSelectedCostings({})
    setSelectedVolumes({})
    setActionError('')
    const rfq = rfqs.find((item) => item.id === rfqId)
    const rfqParts = rfq?.parts ?? []
    if (!rfqParts.length) {
      setActionError('This RFQ has no parts available.')
      return
    }

    setLoadingCostings(true)
    try {
      const results = await Promise.all(
        rfqParts.map(async (part) => {
          const response = await api.get(`/costings/part/${part.id}`)
          const records = getList<CostingOption>(response)
          return { partId: part.id, records }
        }),
      )
      const options: Record<string, CostingOption[]> = {}
      results.forEach(({ partId, records }) => {
        options[partId] = records
        if (records.length) {
          const latest = records[0]
          setSelectedCostings((previous) => ({ ...previous, [partId]: latest.id }))
          const volumes = Array.isArray(latest.volumes) ? latest.volumes : []
          if (volumes.length) {
            setSelectedVolumes((previous) => ({
              ...previous,
              [partId]: String(volumes[0].annualVolume ?? volumes[0].quantity ?? ''),
            }))
          }
        }
      })
      setCostingOptions(options)
      const missing = results.filter((item) => item.records.length === 0)
      if (missing.length) {
        setActionError(`${missing.length} part(s) do not have saved costing records. Generate costing before creating the quotation.`)
      }
    } catch (error) {
      setActionError(getErrorMessage(error, 'Could not load saved costings for this RFQ.'))
    } finally {
      setLoadingCostings(false)
    }
  }

  const selectedCostingFor = (partId: string) =>
    (costingOptions[partId] || []).find((item) => item.id === selectedCostings[partId])

  const volumesFor = (partId: string): CostingVolume[] => {
    const costing = selectedCostingFor(partId)
    if (!costing) return []
    if (Array.isArray(costing.volumes)) return costing.volumes
    if (costing.volumes && typeof costing.volumes === 'object') {
      return Object.entries(costing.volumes).map(([key, value]): CostingVolume =>
        isCostingVolume(value)
          ? { annualVolume: Number(key), ...value }
          : { annualVolume: Number(key), unitPrice: value },
      )
    }
    return []
  }

  const createQuotation = async () => {
    if (!chosenRFQ || !parts.length) {
      setActionError('Select an RFQ with at least one part.')
      return
    }

    const quotationParts = parts.map((part) => ({
      partId: part.id,
      costingId: selectedCostings[part.id],
      annualVolume: Number(selectedVolumes[part.id]),
    }))

    const incomplete = quotationParts.some(
      (part) => !part.costingId || !Number.isFinite(part.annualVolume) || part.annualVolume <= 0,
    )
    if (incomplete) {
      setActionError('Select a saved costing and valid annual volume for every part.')
      return
    }

    setSaving(true)
    setActionError('')
    try {
      await api.post('/quotations', {
        rfqId: selectedRFQ,
        ...(validUntil ? { validUntil } : {}),
        gstPercentage: Number(gstPercentage),
        notes: notes.trim() || undefined,
        paymentTerms: paymentTerms.trim() || undefined,
        deliveryTerms: deliveryTerms.trim() || undefined,
        commercialTerms: commercialTerms.trim() || undefined,
        parts: quotationParts,
      })
      setShowCreate(false)
      await loadData()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Quotation could not be created.'))
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (
    quotation: Quotation,
    action: 'submit' | 'approve' | 'reject' | 'send',
  ) => {
    setActionId(quotation.id)
    setActionError('')
    try {
      if (action === 'reject') {
        const comments = window.prompt('Enter the reason for rejecting this quotation:')
        if (!comments || comments.trim().length < 5) {
          setActionId('')
          return
        }
        await api.post(`/quotations/${quotation.id}/reject`, { comments: comments.trim() })
      } else {
        await api.post(`/quotations/${quotation.id}/${action}`)
      }
      await loadData()
      if (selectedQuotation?.id === quotation.id) {
        const response = await api.get(`/quotations/${quotation.id}`)
        setSelectedQuotation(getObject<Quotation>(response))
      }
    } catch (error) {
      setActionError(getErrorMessage(error, `Unable to ${action} this quotation.`))
    } finally {
      setActionId('')
    }
  }

  const openDetails = async (quotation: Quotation) => {
    setActionError('')
    try {
      const response = await api.get(`/quotations/${quotation.id}`)
      setSelectedQuotation(getObject<Quotation>(response))
    } catch (error) {
      setActionError(getErrorMessage(error, 'Could not load quotation details.'))
    }
  }

  const downloadQuotationPdf = async (quotation: Quotation) => {
    setActionId(quotation.id)
    setActionError('')

    try {
      const response = await api.get(`/quotations/${quotation.id}/pdf`, {
        responseType: 'blob',
      })

      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')

      link.href = url
      link.download = `${quotation.quotationNumber || 'quotation'}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      setActionError('Unable to download the quotation PDF.')
    } finally {
      setActionId('')
    }
  }

  const counts = {
    total: quotations.length,
    pending: quotations.filter((item) => item.status === 'PENDING_APPROVAL').length,
    approved: quotations.filter((item) => item.status === 'APPROVED').length,
    sent: quotations.filter((item) => item.status === 'SENT').length,
  }

  return (
    <div className="quotation-page">
      <div className="quotation-heading">
        <div>
          <span className="quotation-eyebrow">COMMERCIAL MANAGEMENT</span>
          <h1>Quotations</h1>
          <p>Create, review and manage customer quotations.</p>
        </div>
        <div className="quotation-heading-actions">
          <button className="quotation-button secondary" onClick={loadData}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="quotation-button primary" onClick={openCreate}>
            <Plus size={17} /> New quotation
          </button>
        </div>
      </div>

      <div className="quotation-stats">
        <div><span>Total quotations</span><strong>{counts.total}</strong></div>
        <div><span>Pending approval</span><strong>{counts.pending}</strong></div>
        <div><span>Approved</span><strong>{counts.approved}</strong></div>
        <div><span>Sent to customer</span><strong>{counts.sent}</strong></div>
      </div>

      {actionError && !showCreate && (
        <div className="quotation-alert"><AlertCircle size={16} />{actionError}
          <button onClick={() => setActionError('')} aria-label="Dismiss"><X size={15} /></button>
        </div>
      )}

      <section className="quotation-panel">
        <div className="quotation-toolbar">
          <div className="quotation-search">
            <Search size={17} />
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="Search quotation, customer or RFQ..." />
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="ALL">All statuses</option>
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'WON', 'LOST'].map((status) =>
              <option key={status} value={status}>{statusLabel(status)}</option>
            )}
          </select>
        </div>

        {loading ? <div className="quotation-empty">Loading quotations...</div> :
          error ? <div className="quotation-empty error">{error}</div> :
          filteredQuotations.length === 0 ? (
            <div className="quotation-empty">
              <FileText size={30} />
              <strong>No quotations found</strong>
              <span>Create a quotation from an RFQ with saved costing records.</span>
            </div>
          ) : (
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead><tr>
                  <th>Quotation</th><th>Customer</th><th>RFQ</th><th>Created</th>
                  <th>Grand total</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {filteredQuotations.map((quotation) => (
                    <tr key={quotation.id}>
                      <td><strong>{quotation.quotationNumber}</strong></td>
                      <td>{quotation.customer?.name || '—'}</td>
                      <td>{quotation.rfq?.rfqNumber || '—'}</td>
                      <td>{quotation.createdAt ? new Date(quotation.createdAt).toLocaleDateString('en-IN') : '—'}</td>
                      <td className="quotation-amount">{money(quotation.grandTotal)}</td>
                      <td><span className={`quotation-status ${statusClass(quotation.status)}`}>{statusLabel(quotation.status)}</span></td>
                      <td><button className="quotation-icon-button" title="View details" onClick={() => openDetails(quotation)}><Eye size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {showCreate && (
        <div className="quotation-overlay">
          <section className="quotation-modal">
            <div className="quotation-modal-heading">
              <div><span className="quotation-eyebrow">NEW DOCUMENT</span><h2>Create quotation</h2></div>
              <button className="quotation-icon-button" onClick={() => setShowCreate(false)}><X size={19} /></button>
            </div>
            <label className="quotation-field">Select RFQ
              <select value={selectedRFQ} onChange={(event) => loadCostings(event.target.value)}>
                <option value="">Choose an RFQ</option>
                {rfqs.map((rfq) => <option key={rfq.id} value={rfq.id}>{rfq.rfqNumber} — {rfq.customer?.name || 'Customer'}</option>)}
              </select>
            </label>

            {loadingCostings && <p className="quotation-hint">Loading saved costings...</p>}
            {parts.length > 0 && (
              <div className="quotation-part-list">
                <h3>Quotation parts</h3>
                {parts.map((part) => {
                  const options = costingOptions[part.id] || []
                  const costing = selectedCostingFor(part.id)
                  const volumes = volumesFor(part.id)
                  return (
                    <div className="quotation-part-card" key={part.id}>
                      <div><strong>{part.partNumber || part.partName || part.name || 'Part'}</strong>
                        <span>{part.partName || part.description || part.materialGrade || ''}</span></div>
                      <label>Costing version
                        <select value={selectedCostings[part.id] || ''}
                          onChange={(event) => {
                            const next = options.find((item) => item.id === event.target.value)
                            setSelectedCostings((previous) => ({ ...previous, [part.id]: event.target.value }))
                            const nextVolumes = Array.isArray(next?.volumes) ? next.volumes : []
                            setSelectedVolumes((previous) => ({
                              ...previous,
                              [part.id]: String(nextVolumes[0]?.annualVolume ?? nextVolumes[0]?.quantity ?? ''),
                            }))
                          }}>
                          <option value="">Select saved costing</option>
                          {options.map((item) => <option key={item.id} value={item.id}>Version {item.version || 1} — {item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-IN') : 'Saved'}</option>)}
                        </select>
                      </label>
                      <label>Annual volume
                        <select value={selectedVolumes[part.id] || ''}
                          onChange={(event) => setSelectedVolumes((previous) => ({ ...previous, [part.id]: event.target.value }))}>
                          <option value="">Select volume</option>
                          {volumes.map((volume, index) => {
                            const value = volume.annualVolume ?? volume.quantity
                            return <option key={`${value}-${index}`} value={String(value)}>{Number(value).toLocaleString('en-IN')}</option>
                          })}
                        </select>
                      </label>
                      {costing && <span className="quotation-hint">Saved costing selected</span>}
                      {selectedRFQ && !options.length && !loadingCostings && <span className="quotation-missing">No saved costing for this part</span>}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="quotation-form-grid">
              <label className="quotation-field">Valid until
                <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              </label>
              <label className="quotation-field">GST percentage
                <input type="number" min="0" max="100" step="0.01" value={gstPercentage}
                  onChange={(event) => setGstPercentage(event.target.value)} />
              </label>
            </div>
            <label className="quotation-field">Notes
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)}
                placeholder="Add commercial notes or special conditions..." />
            </label>
            <label className="quotation-field">Payment terms
              <textarea rows={2} value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)}
                placeholder="For example: payment schedule, credit period or advance requirement" />
            </label>
            <label className="quotation-field">Delivery terms
              <textarea rows={2} value={deliveryTerms} onChange={(event) => setDeliveryTerms(event.target.value)}
                placeholder="For example: lead time, delivery point and dispatch terms" />
            </label>
            <label className="quotation-field">Other commercial conditions
              <textarea rows={2} value={commercialTerms} onChange={(event) => setCommercialTerms(event.target.value)}
                placeholder="Add conditions that should appear in the quotation PDF" />
            </label>
            <p>Quotation submission and sending require Plant Head approval of each current routing revision and a costing from that revision. Manage technical review in the Costing workspace.</p>
            {actionError && <div className="quotation-alert"><AlertCircle size={16} />{actionError}</div>}
            <div className="quotation-modal-actions">
              <button className="quotation-button secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="quotation-button primary" disabled={saving || loadingCostings || !selectedRFQ}
                onClick={createQuotation}>{saving ? 'Creating...' : 'Create quotation'}</button>
            </div>
          </section>
        </div>
      )}

      {selectedQuotation && (
        <div className="quotation-overlay">
          <section className="quotation-modal quotation-detail-modal">
            <div className="quotation-modal-heading">
              <div><span className="quotation-eyebrow">QUOTATION DETAILS</span>
                <h2>{selectedQuotation.quotationNumber}</h2>
                <span className={`quotation-status ${statusClass(selectedQuotation.status)}`}>{statusLabel(selectedQuotation.status)}</span>
              </div>
              <button className="quotation-icon-button" onClick={() => setSelectedQuotation(null)}><X size={19} /></button>
            </div>
            <div className="quotation-detail-grid">
              <div><span>Customer</span><strong>{selectedQuotation.customer?.name || '—'}</strong></div>
              <div><span>RFQ</span><strong>{selectedQuotation.rfq?.rfqNumber || '—'}</strong></div>
              <div><span>Subtotal</span><strong>{money(selectedQuotation.subtotal)}</strong></div>
              <div><span>GST</span><strong>{money(selectedQuotation.gstAmount)}</strong></div>
              <div><span>Grand total</span><strong>{money(selectedQuotation.grandTotal)}</strong></div>
              <div><span>Valid until</span><strong>{selectedQuotation.validUntil ? new Date(selectedQuotation.validUntil).toLocaleDateString('en-IN') : '—'}</strong></div>
            </div>
            <div className="quotation-table-wrap">
              <table className="quotation-table">
                <thead><tr><th>Part</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead>
                <tbody>{(selectedQuotation.parts || []).map((line) => (
                  <tr key={line.id}>
                    <td>{line.part?.partNumber || line.part?.partName || line.partId}</td>
                    <td>{Number(line.quantity || 0).toLocaleString('en-IN')}</td>
                    <td>{money(line.unitPrice)}</td><td>{money(line.totalPrice)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {selectedQuotation.notes && <p className="quotation-detail-notes">{selectedQuotation.notes}</p>}
            {(selectedQuotation.paymentTerms || selectedQuotation.deliveryTerms || selectedQuotation.commercialTerms) && (
              <div className="quotation-detail-notes">
                {selectedQuotation.paymentTerms && <p><strong>Payment terms:</strong> {selectedQuotation.paymentTerms}</p>}
                {selectedQuotation.deliveryTerms && <p><strong>Delivery terms:</strong> {selectedQuotation.deliveryTerms}</p>}
                {selectedQuotation.commercialTerms && <p><strong>Other commercial conditions:</strong> {selectedQuotation.commercialTerms}</p>}
              </div>
            )}
            <div className="quotation-modal-actions quotation-action-row">
              {(selectedQuotation.status === 'APPROVED' || selectedQuotation.status === 'SENT') &&
                <button
                  className="quotation-button secondary"
                  disabled={actionId === selectedQuotation.id}
                  onClick={() => downloadQuotationPdf(selectedQuotation)}
                >
                  <Printer size={16} /> Download PDF
                </button>}
              {selectedQuotation.status === 'DRAFT' && (role === 'ESTIMATOR' || role === 'ADMIN') &&
                <button className="quotation-button primary" disabled={actionId === selectedQuotation.id} onClick={() => runAction(selectedQuotation, 'submit')}><Clock size={16} /> Submit for commercial approval</button>}
              {selectedQuotation.status === 'PENDING_APPROVAL' && role === 'SALES_HEAD' &&
                <>
                  <button className="quotation-button danger" disabled={actionId === selectedQuotation.id} onClick={() => runAction(selectedQuotation, 'reject')}><XCircle size={16} /> Reject</button>
                  <button className="quotation-button primary" disabled={actionId === selectedQuotation.id} onClick={() => runAction(selectedQuotation, 'approve')}><CheckCircle size={16} /> Approve</button>
                </>}
              {selectedQuotation.status === 'APPROVED' && role === 'SALES_HEAD' &&
                <button className="quotation-button primary" disabled={actionId === selectedQuotation.id} onClick={() => runAction(selectedQuotation, 'send')}><Send size={16} /> Mark as sent internally</button>}
            </div>
            {actionError && <div className="quotation-alert"><AlertCircle size={16} />{actionError}</div>}
          </section>
        </div>
      )}
    </div>
  )
}
