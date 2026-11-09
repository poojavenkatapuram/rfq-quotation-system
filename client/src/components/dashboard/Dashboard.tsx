import { useEffect, useMemo, useState } from 'react'
import {
  ClipboardList,
  FileText,
  Clock3,
  TrendingUp,
  Plus,
  ArrowUpRight,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'

type RFQ = {
  id: string
  rfqNumber: string
  status: string
  receivedDate: string
  dueDate: string | null
  customer: { name: string }
  assignedTo: { name: string } | null
  parts: { name: string; materialGrade: string | null }[]
}

type Activity = {
  id: string
  action: string
  entityType: string
  createdAt: string
  actor: { name: string } | null
}

type Deadline = RFQ

type Summary = {
  metrics: {
    totalRFQs: number
    activeRFQs: number
    totalQuotations: number
    activeQuotations: number
    pendingApprovals: number
    wonRFQs: number
  }
  rfqStatusCounts: Record<string, number>
  quotationStatusCounts: Record<string, number>
  recentActivity: Activity[]
  upcomingDeadlines: Deadline[]
  recentRFQs: RFQ[]
}

const fetchDashboardSummary = async (): Promise<Summary> => {
  const response = await api.get('/dashboard/summary')
  return response.data.data
}

const statusLabels: Record<string, string> = {
  RECEIVED: 'Received',
  ESTIMATING: 'Estimating',
  PENDING_APPROVAL: 'Pending Approval',
  QUOTATION_SENT: 'Quotation Sent',
  WON: 'Won',
  LOST: 'Lost',
}

const statusClasses: Record<string, string> = {
  RECEIVED: 'status-blue',
  ESTIMATING: 'status-blue',
  PENDING_APPROVAL: 'status-amber',
  QUOTATION_SENT: 'status-purple',
  WON: 'status-green',
  LOST: 'status-red',
}

const statusColors: Record<string, string> = {
  RECEIVED: '#64748b',
  ESTIMATING: '#3b82f6',
  PENDING_APPROVAL: '#f59e0b',
  QUOTATION_SENT: '#8b5cf6',
  WON: '#22c55e',
  LOST: '#ef4444',
}

function formatDate(value: string | null) {
  if (!value) return 'Not set'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function timeAgo(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`

  return formatDate(value)
}

function displayAction(action: string) {
  return action
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function Dashboard({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('All')

  const loadDashboard = async () => {
    try {
      setError('')
      setSummary(await fetchDashboardSummary())
    } catch (err) {
      console.error('Dashboard loading failed:', err)
      setError('Unable to load dashboard data. Please check your connection and sign in again if needed.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true

    const loadInitialDashboard = async () => {
      try {
        const data = await fetchDashboardSummary()
        if (isCurrent) setSummary(data)
      } catch (error) {
        console.error('Dashboard loading failed:', error)
        if (isCurrent) {
          setError('Unable to load dashboard data. Please check your connection and sign in again if needed.')
        }
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialDashboard()

    return () => {
      isCurrent = false
    }
  }, [])

  const filteredRFQs = useMemo(() => {
    if (!summary) return []

    return summary.recentRFQs.filter((rfq) => {
      const firstPart = rfq.parts[0]
      const searchText = [
        rfq.rfqNumber,
        rfq.customer.name,
        firstPart?.name || '',
        firstPart?.materialGrade || '',
      ].join(' ').toLowerCase()

      const matchesSearch = searchText.includes(search.toLowerCase())
      const matchesFilter =
        activeFilter === 'All' ||
        statusLabels[rfq.status] === activeFilter

      return matchesSearch && matchesFilter
    })
  }, [summary, search, activeFilter])

  const donutBackground = useMemo(() => {
    if (!summary || summary.metrics.totalRFQs === 0) {
      return 'conic-gradient(#263244 0deg 360deg)'
    }

    const order = [
      'RECEIVED',
      'ESTIMATING',
      'PENDING_APPROVAL',
      'QUOTATION_SENT',
      'WON',
      'LOST',
    ]

    let current = 0
    const segments = order.map((status) => {
      const count = summary.rfqStatusCounts[status] || 0
      const start = current
      current += (count / summary.metrics.totalRFQs) * 360
      return `${statusColors[status]} ${start}deg ${current}deg`
    })

    return `conic-gradient(${segments.join(', ')})`
  }, [summary])

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  })()

  const { user } = useAuth()
  const firstName = user?.name?.split(' ')[0] || 'there'

  if (loading) {
    return (
      <section className="coming-soon">
        <RefreshCw size={25} className="muted-icon" />
        <h2>Loading dashboard</h2>
        <p>Retrieving the latest RFQ and quotation data.</p>
      </section>
    )
  }

  if (error || !summary) {
    return (
      <section className="coming-soon">
        <AlertCircle size={25} className="muted-icon" />
        <h2>Dashboard unavailable</h2>
        <p>{error || 'No dashboard data was returned.'}</p>
        <button className="primary-button" onClick={() => {
          setLoading(true)
          void loadDashboard()
        }}>
          <RefreshCw size={17} />
          Retry
        </button>
      </section>
    )
  }

  const metrics = summary.metrics

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow">OVERVIEW</div>
          <h2>{greeting}, {firstName}</h2>
          <p>Here's what's happening with your RFQs today.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => onNavigate('RFQ Register')}
        >
          <Plus size={18} />
          Create new RFQ
        </button>
      </section>

      <section className="metrics-grid">
        <Metric
          title="Total RFQs"
          value={metrics.totalRFQs}
          description="All registered RFQs"
          icon={ClipboardList}
          iconClass="metric-blue"
        />
        <Metric
          title="Active RFQs"
          value={metrics.activeRFQs}
          description="Not yet closed"
          icon={FileText}
          iconClass="metric-purple"
        />
        <Metric
          title="Pending Approvals"
          value={metrics.pendingApprovals}
          description="Awaiting Sales Head"
          icon={Clock3}
          iconClass="metric-amber"
        />
        <Metric
          title="Won RFQs"
          value={metrics.wonRFQs}
          description="Successfully won"
          icon={TrendingUp}
          iconClass="metric-green"
        />
      </section>

      <section className="middle-grid">
        <div className="panel performance-panel">
          <div className="panel-heading">
            <div>
              <h3>Quotation overview</h3>
              <p>Current quotation pipeline</p>
            </div>
          </div>

          <div className="performance-summary">
            <div>
              <span>Total quotations</span>
              <strong>{metrics.totalQuotations}</strong>
            </div>
            <div>
              <span>Active quotations</span>
              <strong>{metrics.activeQuotations}</strong>
            </div>
            <div>
              <span>Pending approvals</span>
              <strong>{metrics.pendingApprovals}</strong>
            </div>
          </div>

          <div className="quotation-status-list">
            {Object.entries(summary.quotationStatusCounts).map(([status, count]) => (
              <div className="quotation-status-row" key={status}>
                <span>{status.replaceAll('_', ' ')}</span>
                <strong>{count}</strong>
              </div>
            ))}
            {summary.metrics.totalQuotations === 0 && (
              <p className="empty-state">No quotations have been created yet.</p>
            )}
          </div>
        </div>

        <div className="panel status-panel">
          <div className="panel-heading">
            <div>
              <h3>RFQ distribution</h3>
              <p>Current pipeline overview</p>
            </div>
          </div>

          <div className="donut-wrap">
            <div className="donut" style={{ background: donutBackground }}>
              <div className="donut-center">
                <strong>{metrics.totalRFQs}</strong>
                <span>Total RFQs</span>
              </div>
            </div>
          </div>

          <div className="legend">
            {Object.entries(statusLabels).map(([status, label]) => (
              <LegendItem
                key={status}
                color={statusColors[status]}
                label={label}
                value={summary.rfqStatusCounts[status] || 0}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="panel rfq-panel">
        <div className="panel-heading rfq-heading">
          <div>
            <h3>Recent RFQs</h3>
            <p>Latest requests registered in the system</p>
          </div>
          <button
            className="text-button"
            onClick={() => onNavigate('RFQ Register')}
          >
            View all RFQs <ArrowUpRight size={16} />
          </button>
        </div>

        <div className="table-toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              type="text"
              placeholder="Search RFQ, customer or part..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="filter-group">
            {['All', 'Received', 'Estimating', 'Pending Approval', 'Quotation Sent'].map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`filter-button ${activeFilter === filter ? 'filter-active' : ''}`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="table-scroll">
          <table className="rfq-table">
            <thead>
              <tr>
                <th>RFQ NUMBER</th>
                <th>CUSTOMER</th>
                <th>PART NAME</th>
                <th>MATERIAL</th>
                <th>RECEIVED</th>
                <th>DUE DATE</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filteredRFQs.map((rfq) => {
                const part = rfq.parts[0]
                return (
                  <tr key={rfq.id}>
                    <td className="rfq-id">{rfq.rfqNumber}</td>
                    <td>{rfq.customer.name}</td>
                    <td className="part-name">{part?.name || '—'}</td>
                    <td>
                      <span className="material-tag">{part?.materialGrade || '—'}</span>
                    </td>
                    <td>{formatDate(rfq.receivedDate)}</td>
                    <td>{formatDate(rfq.dueDate)}</td>
                    <td>
                      <span className={`status-badge ${statusClasses[rfq.status] || 'status-blue'}`}>
                        <span />
                        {statusLabels[rfq.status] || rfq.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filteredRFQs.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No RFQs match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>Showing {filteredRFQs.length} of {summary.recentRFQs.length} recent RFQs</span>
          <button
            className="text-button"
            onClick={() => {
              setSearch('')
              setActiveFilter('All')
            }}
          >
            Clear filters
          </button>
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel activity-panel">
          <div className="panel-heading">
            <div>
              <h3>Recent activity</h3>
              <p>Latest recorded workspace events</p>
            </div>
            <CheckCircle2 size={19} className="muted-icon" />
          </div>

          {summary.recentActivity.map((activity) => (
            <div className="activity-item" key={activity.id}>
              <div className="activity-icon activity-blue">
                <FileText size={17} />
              </div>
              <div className="activity-copy">
                <strong>{displayAction(activity.action)}</strong>
                <span>
                  {activity.entityType}
                  {activity.actor ? ` · ${activity.actor.name}` : ''}
                </span>
              </div>
              <span className="activity-time">{timeAgo(activity.createdAt)}</span>
            </div>
          ))}
          {summary.recentActivity.length === 0 && (
            <p className="empty-state">No activity has been recorded yet.</p>
          )}
        </div>

        <div className="panel deadline-panel">
          <div className="panel-heading">
            <div>
              <h3>Upcoming deadlines</h3>
              <p>Open RFQs with due dates</p>
            </div>
            <Clock3 size={19} className="muted-icon" />
          </div>

          {summary.upcomingDeadlines.map((rfq) => (
            <div className="deadline-item" key={rfq.id}>
              <div className="deadline-date">
                {rfq.dueDate
                  ? new Date(rfq.dueDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                    }).toUpperCase()
                  : '—'}
              </div>
              <div className="deadline-copy">
                <strong>{rfq.parts[0]?.name || rfq.rfqNumber}</strong>
                <span>{rfq.customer.name}</span>
              </div>
              <span className="activity-time">{statusLabels[rfq.status] || rfq.status}</span>
            </div>
          ))}
          {summary.upcomingDeadlines.length === 0 && (
            <p className="empty-state">No upcoming RFQ deadlines.</p>
          )}
        </div>
      </section>

      <footer className="footer">
        <span>ForgeFlow RFQ Management System</span>
        <span>Live data · Connected to PostgreSQL</span>
      </footer>
    </>
  )
}

function Metric({
  title,
  value,
  description,
  icon: Icon,
  iconClass,
}: {
  title: string
  value: number
  description: string
  icon: typeof ClipboardList
  iconClass: string
}) {
  return (
    <div className="panel metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <div className={`metric-icon ${iconClass}`}>
          <Icon size={19} />
        </div>
      </div>
      <strong className="metric-value">{value.toLocaleString('en-IN')}</strong>
      <div className="metric-bottom">
        <span>{description}</span>
      </div>
    </div>
  )
}

function LegendItem({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: number
}) {
  return (
    <div className="legend-item">
      <span className="legend-dot" style={{ background: color }} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default Dashboard
