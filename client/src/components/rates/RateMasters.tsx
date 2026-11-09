import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import axios from 'axios'
import {
  AlertCircle,
  Check,
  Clock,
  Factory,
  IndianRupee,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
import './RateMasters.css'

type MaterialRate = {
  id: string
  materialCode: string
  materialName: string
  grade: string
  ratePerKg: number | string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

type MachineRate = {
  id: string
  machineCode: string
  machineName: string
  ratePerHour: number | string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
}

type RateForm = {
  code: string
  name: string
  grade: string
  rate: string
  effectiveFrom: string
  effectiveTo: string
}

type RateTab = 'materials' | 'machines'
type StatusFilter = 'all' | 'active' | 'inactive'

const today = () => {
  const date = new Date()
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return localDate.toISOString().slice(0, 10)
}

const emptyForm = (): RateForm => ({
  code: '',
  name: '',
  grade: '',
  rate: '',
  effectiveFrom: today(),
  effectiveTo: '',
})

const formatDate = (value: string | null) => {
  if (!value) return 'Open-ended'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
}

const formatRate = (value: number | string) =>
  Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const getErrorMessage = (error: unknown, fallback: string) =>
  axios.isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message || fallback
    : fallback

const fetchRateMasters = async () => {
  const [materialsResponse, machinesResponse] = await Promise.all([
    api.get('/material-rates'),
    api.get('/machine-rates'),
  ])

  return {
    materialRates: materialsResponse.data.data ?? [],
    machineRates: machinesResponse.data.data ?? [],
  }
}

export default function RateMasters() {
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'PLANT_HEAD'

  const [tab, setTab] = useState<RateTab>('materials')
  const [materialRates, setMaterialRates] = useState<MaterialRate[]>([])
  const [machineRates, setMachineRates] = useState<MachineRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RateForm>(emptyForm())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadRates = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true)
    setError('')

    try {
      const data = await fetchRateMasters()
      setMaterialRates(data.materialRates)
      setMachineRates(data.machineRates)
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to load rate masters. Please try again.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let isCurrent = true

    const loadInitialRates = async () => {
      try {
        const data = await fetchRateMasters()
        if (!isCurrent) return

        setMaterialRates(data.materialRates)
        setMachineRates(data.machineRates)
      } catch (error) {
        if (isCurrent) {
          setError(getErrorMessage(error, 'Unable to load rate masters. Please try again.'))
        }
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialRates()

    return () => {
      isCurrent = false
    }
  }, [])

  const currentRates = tab === 'materials' ? materialRates : machineRates

  const activeCount = currentRates.filter((rate) => rate.isActive).length
  const inactiveCount = currentRates.length - activeCount

  const filteredRates = useMemo(() => {
    const query = search.trim().toLowerCase()

    return currentRates.filter((rate) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && rate.isActive) ||
        (statusFilter === 'inactive' && !rate.isActive)

      const searchable =
        tab === 'materials'
          ? `${(rate as MaterialRate).materialCode} ${(rate as MaterialRate).materialName} ${(rate as MaterialRate).grade}`
          : `${(rate as MachineRate).machineCode} ${(rate as MachineRate).machineName}`

      return matchesStatus && searchable.toLowerCase().includes(query)
    })
  }, [currentRates, search, statusFilter, tab])

  const openCreateForm = () => {
    setForm(emptyForm())
    setError('')
    setSuccess('')
    setShowForm(true)
  }

  const closeForm = () => {
    if (saving) return
    setShowForm(false)
    setError('')
  }

  const updateForm = (field: keyof RateForm, value: string) => {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')

    const rateValue = Number(form.rate)

    if (!Number.isFinite(rateValue) || rateValue <= 0) {
      setError('Enter a valid positive rate.')
      return
    }

    if (
      form.effectiveTo &&
      new Date(form.effectiveTo) <= new Date(form.effectiveFrom)
    ) {
      setError('Effective To must be later than Effective From.')
      return
    }

    setSaving(true)

    try {
      if (tab === 'materials') {
        await api.post('/material-rates', {
          materialCode: form.code.trim(),
          materialName: form.name.trim(),
          grade: form.grade.trim(),
          ratePerKg: rateValue,
          currency: 'INR',
          effectiveFrom: form.effectiveFrom,
          effectiveTo: form.effectiveTo || null,
        })
      } else {
        await api.post('/machine-rates', {
          machineCode: form.code.trim(),
          machineName: form.name.trim(),
          ratePerHour: rateValue,
          currency: 'INR',
          effectiveFrom: form.effectiveFrom,
          ...(form.effectiveTo
            ? { effectiveTo: form.effectiveTo }
            : {}),
        })
      }

      setShowForm(false)
      setSuccess(
        `${tab === 'materials' ? 'Material' : 'Machine'} rate version created successfully.`,
      )
      await loadRates(false)
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to create rate. Check the entered details and try again.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (id: string) => {
    const confirmed = window.confirm(
      'Deactivate this rate? Existing quotations and historical rate records will not be overwritten.',
    )

    if (!confirmed) return

    setError('')
    setSuccess('')
    setDeactivatingId(id)

    try {
      const endpoint =
        tab === 'materials' ? '/material-rates' : '/machine-rates'

      await api.patch(`${endpoint}/${id}/deactivate`)

      setSuccess('Rate deactivated. Historical records have been preserved.')
      await loadRates(false)
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to deactivate this rate.'))
    } finally {
      setDeactivatingId(null)
    }
  }

  return (
    <div className="rates-page">
      <div className="rates-heading">
        <div>
          <span className="rates-eyebrow">CONFIGURATION</span>
          <h1>Rate Masters</h1>
          <p>
            Manage material and machine rates with effective dates and
            historical versions.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            className="rates-primary-button"
            onClick={openCreateForm}
          >
            <Plus size={15} />
            Add New Rate
          </button>
        )}
      </div>

      <div className="rates-stats">
        <div className="rates-stat-card">
          <span>Total rate records</span>
          <strong>{currentRates.length}</strong>
          <small>
            {tab === 'materials' ? 'Material rate versions' : 'Machine rate versions'}
          </small>
        </div>

        <div className="rates-stat-card">
          <span>Active records</span>
          <strong>{activeCount}</strong>
          <small>Currently marked active</small>
        </div>

        <div className="rates-stat-card">
          <span>Inactive records</span>
          <strong>{inactiveCount}</strong>
          <small>Historical or deactivated versions</small>
        </div>
      </div>

      <section className="rates-panel">
        <div className="rates-panel-top">
          <div className="rates-tabs">
            <button
              type="button"
              className={`rates-tab ${tab === 'materials' ? 'active' : ''}`}
              onClick={() => {
                setTab('materials')
                setSearch('')
                setStatusFilter('all')
                setError('')
              }}
            >
              <IndianRupee size={15} />
              Material Rates
              <span>{materialRates.length}</span>
            </button>

            <button
              type="button"
              className={`rates-tab ${tab === 'machines' ? 'active' : ''}`}
              onClick={() => {
                setTab('machines')
                setSearch('')
                setStatusFilter('all')
                setError('')
              }}
            >
              <Factory size={15} />
              Machine Rates
              <span>{machineRates.length}</span>
            </button>
          </div>

          <button
            type="button"
            className="rates-refresh-button"
            onClick={() => void loadRates()}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'rates-spinning' : ''} />
            Refresh
          </button>
        </div>

        <div className="rates-toolbar">
          <div className="rates-search">
            <Search size={15} />
            <input
              type="search"
              placeholder={
                tab === 'materials'
                  ? 'Search material code, name or grade...'
                  : 'Search machine code or name...'
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <span className="rates-result-count">
            {filteredRates.length} records
          </span>
        </div>

        {error && !showForm && (
          <div className="rates-feedback error">
            <AlertCircle size={15} />
            {error}
            <button type="button" onClick={() => setError('')} aria-label="Dismiss error">
              <X size={14} />
            </button>
          </div>
        )}

        {success && (
          <div className="rates-feedback success">
            <Check size={15} />
            {success}
            <button type="button" onClick={() => setSuccess('')} aria-label="Dismiss success">
              <X size={14} />
            </button>
          </div>
        )}

        {loading ? (
          <div className="rates-loading">
            <LoaderCircle size={19} className="rates-spinning" />
            Loading rate records...
          </div>
        ) : (
          <div className="rates-table-wrap">
            <table className="rates-table">
              <thead>
                {tab === 'materials' ? (
                  <tr>
                    <th>Material</th>
                    <th>Grade</th>
                    <th>Rate / kg</th>
                    <th>Effective From</th>
                    <th>Effective To</th>
                    <th>Status</th>
                    {canManage && <th>Action</th>}
                  </tr>
                ) : (
                  <tr>
                    <th>Machine</th>
                    <th>Machine Code</th>
                    <th>Rate / hour</th>
                    <th>Effective From</th>
                    <th>Effective To</th>
                    <th>Status</th>
                    {canManage && <th>Action</th>}
                  </tr>
                )}
              </thead>

              <tbody>
                {filteredRates.length === 0 ? (
                  <tr>
                    <td
                      colSpan={canManage ? 7 : 6}
                      className="rates-empty"
                    >
                      {currentRates.length === 0
                        ? 'No rate records found. Add the first rate to get started.'
                        : 'No records match your search or status filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredRates.map((rate) => {
                    const material = rate as MaterialRate
                    const machine = rate as MachineRate

                    return (
                      <tr key={rate.id}>
                        {tab === 'materials' ? (
                          <>
                            <td>
                              <strong>{material.materialName}</strong>
                              <small>{material.materialCode}</small>
                            </td>
                            <td>{material.grade}</td>
                            <td className="rates-money">
                              ₹{formatRate(material.ratePerKg)}
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <strong>{machine.machineName}</strong>
                            </td>
                            <td>{machine.machineCode}</td>
                            <td className="rates-money">
                              ₹{formatRate(machine.ratePerHour)}
                            </td>
                          </>
                        )}

                        <td>{formatDate(rate.effectiveFrom)}</td>
                        <td>{formatDate(rate.effectiveTo)}</td>
                        <td>
                          <span
                            className={`rates-status ${rate.isActive ? 'active' : 'inactive'}`}
                          >
                            {rate.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>

                        {canManage && (
                          <td>
                            {rate.isActive ? (
                              <button
                                type="button"
                                className="rates-deactivate"
                                disabled={deactivatingId === rate.id}
                                onClick={() => void handleDeactivate(rate.id)}
                              >
                                {deactivatingId === rate.id ? (
                                  <LoaderCircle size={12} className="rates-spinning" />
                                ) : (
                                  <X size={12} />
                                )}
                                Deactivate
                              </button>
                            ) : (
                              <span className="rates-no-action">Historical record</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="rates-panel-footer">
          <span>
            Rates are stored as versioned records. Existing historical versions
            are not edited when a new rate is created.
          </span>
          <span>
            <Clock size={11} style={{ display: 'inline', marginRight: 5 }} />
            Currency: INR
          </span>
        </div>
      </section>

      {showForm && (
        <div
          className="rates-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeForm()
          }}
        >
          <div
            className="rates-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rates-modal-title"
          >
            <div className="rates-modal-header">
              <h2 id="rates-modal-title">
                Add {tab === 'materials' ? 'Material' : 'Machine'} Rate
              </h2>
              <button
                type="button"
                className="rates-modal-close"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            <div className="rates-history-note">
              <Clock size={16} />
              <span>
                This creates a new rate version. Previous records remain
                available for historical quotations and audit purposes.
              </span>
            </div>

            <form onSubmit={handleCreate}>
              {error && (
                <div className="rates-feedback error">
                  <AlertCircle size={15} />
                  {error}
                </div>
              )}

              <div className="rates-form-grid">
                <label>
                  {tab === 'materials' ? 'Material Code' : 'Machine Code'}
                  <input
                    required
                    minLength={2}
                    maxLength={40}
                    value={form.code}
                    onChange={(event) => updateForm('code', event.target.value)}
                    placeholder={tab === 'materials' ? 'e.g. MAT-EN8' : 'e.g. CNC-01'}
                  />
                </label>

                <label>
                  {tab === 'materials' ? 'Material Name' : 'Machine Name'}
                  <input
                    required
                    minLength={2}
                    maxLength={150}
                    value={form.name}
                    onChange={(event) => updateForm('name', event.target.value)}
                    placeholder={tab === 'materials' ? 'e.g. EN8 Steel' : 'e.g. CNC Turning Centre'}
                  />
                </label>

                {tab === 'materials' && (
                  <label>
                    Material Grade
                    <input
                      required
                      value={form.grade}
                      onChange={(event) => updateForm('grade', event.target.value)}
                      placeholder="e.g. EN8"
                      maxLength={80}
                    />
                  </label>
                )}

                <label>
                  {tab === 'materials' ? 'Rate per kg' : 'Rate per hour'}
                  <div className="rates-number-input">
                    <span>₹</span>
                    <input
                      type="number"
                      required
                      min="0.01"
                      step="0.01"
                      value={form.rate}
                      onChange={(event) => updateForm('rate', event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                </label>

                <label>
                  Effective From
                  <input
                    type="date"
                    required
                    value={form.effectiveFrom}
                    onChange={(event) =>
                      updateForm('effectiveFrom', event.target.value)
                    }
                  />
                </label>

                <label>
                  Effective To <span className="rates-optional">(optional)</span>
                  <input
                    type="date"
                    min={form.effectiveFrom}
                    value={form.effectiveTo}
                    onChange={(event) =>
                      updateForm('effectiveTo', event.target.value)
                    }
                  />
                </label>
              </div>

              <div className="rates-form-actions">
                <button
                  type="button"
                  className="rates-secondary-button"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rates-primary-button"
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <LoaderCircle size={14} className="rates-spinning" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      Create Rate Version
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
