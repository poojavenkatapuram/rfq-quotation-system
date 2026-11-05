import { useCallback, useEffect, useState } from 'react'
import { Search, RefreshCw, Upload, History as HistoryIcon, FileText, Calculator } from 'lucide-react'
import api from '../../services/api'
import './History.css'

type RecordItem = Record<string, any>
type Tab = 'quotations' | 'costings' | 'imported'

const money = (value: number | string | null) =>
  `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString('en-IN') : '—'

export default function History() {
  const [activeTab, setActiveTab] = useState<Tab>('quotations')
  const [records, setRecords] = useState<RecordItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [selected, setSelected] = useState<RecordItem | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<RecordItem | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const endpoint = {
        quotations: '/history/quotations',
        costings: '/history/costings',
        imported: '/history/imported',
      }[activeTab]
      const response = await api.get(endpoint, {
        params: { page, limit: 10, search: search.trim() || undefined },
      })
      setRecords(response.data.data || [])
      setTotalPages(response.data.pagination?.totalPages || 1)
    } catch {
      setError('Unable to load history. Please try again.')
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [activeTab, page, search])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleImport = async () => {
    if (!file) return
    setImporting(true)
    setImportResult(null)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await api.post('/history/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setImportResult(response.data)
      setFile(null)
      await loadHistory()
    } catch (err: any) {
      setError(err.response?.data?.message || 'Excel import failed. Check the file and try again.')
    } finally {
      setImporting(false)
    }
  }

  const changeTab = (tab: Tab) => {
    setActiveTab(tab)
    setPage(1)
    setSearch('')
    setSelected(null)
  }


  return (
    <div className="history-page">
      <div className="history-heading">
        <div>
          <h1><HistoryIcon size={23} /> History</h1>
          <p>Search quotation records, costing versions, and imported legacy quotes.</p>
        </div>
        <button className="history-refresh" onClick={() => void loadHistory()} disabled={loading}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="history-tabs">
        <button className={activeTab === 'quotations' ? 'active' : ''} onClick={() => changeTab('quotations')}>
          <FileText size={16} /> Quotations
        </button>
        <button className={activeTab === 'costings' ? 'active' : ''} onClick={() => changeTab('costings')}>
          <Calculator size={16} /> Costing Versions
        </button>
        <button className={activeTab === 'imported' ? 'active' : ''} onClick={() => changeTab('imported')}>
          <Upload size={16} /> Imported History
        </button>
      </div>

      <div className="history-toolbar">
        <div className="history-search">
          <Search size={17} />
          <input
            value={search}
            placeholder="Search by quote, RFQ, customer, or part..."
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                setPage(1)
                void loadHistory()
              }
            }}
          />
          <button onClick={() => { setPage(1); void loadHistory() }}>Search</button>
        </div>
      </div>

      {error && <div className="history-error">{error}</div>}
      {loading && <div className="history-empty">Loading history...</div>}
      {!loading && records.length === 0 && (
        <div className="history-empty">No records found.</div>
      )}

      {!loading && records.length > 0 && (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                {activeTab === 'quotations' && <>
                  <th>Quotation</th><th>Customer</th><th>RFQ</th><th>Status</th><th>Total</th><th>Date</th>
                </>}
                {activeTab === 'costings' && <>
                  <th>Part</th><th>RFQ</th><th>Version</th><th>Material</th><th>Volumes</th><th>Created</th>
                </>}
                {activeTab === 'imported' && <>
                  <th>Quotation</th><th>Customer</th><th>RFQ</th><th>Parts</th><th>Total</th><th>Date</th>
                </>}
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  {activeTab === 'quotations' && <>
                    <td>{record.quotationNumber}</td>
                    <td>{record.customer?.name || '—'}</td>
                    <td>{record.rfq?.rfqNumber || '—'}</td>
                    <td><span className="history-status">{record.status}</span></td>
                    <td>{money(record.grandTotal)}</td>
                    <td>{date(record.createdAt)}</td>
                  </>}
                  {activeTab === 'costings' && <>
                    <td>{record.part?.partName || '—'}</td>
                    <td>{record.part?.rfq?.rfqNumber || '—'}</td>
                    <td>v{record.version}</td>
                    <td>{record.part?.materialGrade || '—'}</td>
                    <td>{record.volumes?.length || 0}</td>
                    <td>{date(record.createdAt)}</td>
                  </>}
                  {activeTab === 'imported' && <>
                    <td>{record.quotationNumber}</td>
                    <td>{record.customerName}</td>
                    <td>{record.rfqNumber || '—'}</td>
                    <td>{record.parts?.length || 0}</td>
                    <td>{money(record.grandTotal)}</td>
                    <td>{date(record.quoteDate)}</td>
                  </>}
                  <td><button className="history-details" onClick={() => setSelected(record)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="history-pagination">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>Page {page} of {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>

      <section className="history-import">
        <div>
          <h2>Import legacy quotations</h2>
          <p>Upload an Excel workbook (.xlsx) containing historical quotation records.</p>
        </div>
        <input
          type="file"
          accept=".xlsx"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button onClick={() => void handleImport()} disabled={!file || importing}>
          <Upload size={16} /> {importing ? 'Importing...' : 'Import Excel'}
        </button>
      </section>

      {importResult && (
        <div className="history-import-result">
          <h3>Import completed</h3>
          <p>Valid quotations: {importResult.totalValidQuotations ?? 0}</p>
          <p>Imported: {importResult.imported ?? 0}</p>
          <p>Skipped: {importResult.skipped ?? 0}</p>
          <p>Invalid rows: {importResult.invalidRows ?? 0}</p>
        </div>
      )}

      {selected && (
        <div className="history-detail-panel">
          <div className="history-detail-heading">
            <h2>Record details</h2>
            <button onClick={() => setSelected(null)}>Close</button>
          </div>
          <pre>{JSON.stringify(selected, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
