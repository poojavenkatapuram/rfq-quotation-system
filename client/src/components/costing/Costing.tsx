import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Calculator, RefreshCw, Save, Plus, Trash2, History } from 'lucide-react'
import api from '../../services/api'
import './Costing.css'

type Part = {
  id: string
  name: string
  partNumber?: string | null
  materialGrade?: string | null
  grossWeightKg?: number | string | null
  annualVolume?: number | null
  drawingNumber?: string | null
  materialRateId?: string | null
  materialRate?: MaterialRate | null
}

type RFQ = {
  id: string
  rfqNumber: string
  status: string
  customer?: { name: string }
  parts: Part[]
}

type MaterialRate = {
  id: string
  materialCode: string
  materialName: string
  grade: string
  ratePerKg: number | string
  currency: string
  isActive: boolean
  effectiveFrom: string
  effectiveTo?: string | null
}

type MachineRate = {
  id: string
  machineCode: string
  machineName: string
  ratePerHour: number | string
  currency: string
  isActive: boolean
  effectiveFrom: string
  effectiveTo?: string | null
}

type Operation = {
  sequence: number
  operationName: string
  machineRateId: string
  cycleTimeMin: number
  setupTimeMin: number
}

type CostingComponent = {
  id?: string
  type: string
  name: string
  amount: number | string
  description?: string
}

type CostingVolume = {
  annualVolume: number
  unitPrice: number | string
  totalCost: number | string
}

type CostingRecord = {
  id: string
  version: number
  totalCost: number | string
  profitMargin: number | string
  assumptions?: string | null
  createdAt: string
  components: CostingComponent[]
  volumes: CostingVolume[]
  materialRate?: MaterialRate
  createdBy?: { name: string }
}

const money = (value: number | string | undefined) =>
  `₹${Number(value ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const getErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message
  }

  return error instanceof Error ? error.message : 'Something went wrong'
}

const isCurrentlyEffective = (
  rate: { isActive: boolean; effectiveFrom: string; effectiveTo?: string | null },
) => {
  const now = new Date()
  return (
    rate.isActive &&
    new Date(rate.effectiveFrom) <= now &&
    (!rate.effectiveTo || new Date(rate.effectiveTo) > now)
  )
}

export default function Costing() {
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [materialRates, setMaterialRates] = useState<MaterialRate[]>([])
  const [machineRates, setMachineRates] = useState<MachineRate[]>([])
  const [selectedRFQId, setSelectedRFQId] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')
  const [operations, setOperations] = useState<Operation[]>([])

  const [scrapPercentage, setScrapPercentage] = useState(0)
  const [overheadAmount, setOverheadAmount] = useState(0)
  const [packingAmount, setPackingAmount] = useState(0)
  const [freightAmount, setFreightAmount] = useState(0)
  const [profitMargin, setProfitMargin] = useState(10)
  const [annualVolumes, setAnnualVolumes] = useState('180000')
  const [assumptions, setAssumptions] = useState('')

  const [history, setHistory] = useState<CostingRecord[]>([])
  const [latestResult, setLatestResult] = useState<CostingRecord | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const selectedRFQ = rfqs.find((rfq) => rfq.id === selectedRFQId)
  const selectedPart = selectedRFQ?.parts.find(
    (part) => part.id === selectedPartId,
  )

  const availableMaterialRates = useMemo(
    () => materialRates.filter(isCurrentlyEffective),
    [materialRates],
  )

  const availableMachineRates = useMemo(
    () => machineRates.filter(isCurrentlyEffective),
    [machineRates],
  )

  const matchingMaterialRates = useMemo(() => {
    if (!selectedPart?.materialGrade) return []

    return availableMaterialRates.filter(
      (rate) =>
        rate.grade.trim().toLowerCase() ===
        selectedPart.materialGrade?.trim().toLowerCase(),
    )
  }, [availableMaterialRates, selectedPart])

  const loadInitialData = async () => {
    setLoading(true)
    setError('')

    try {
      const [rfqResponse, materialResponse, machineResponse] =
        await Promise.all([
          api.get('/rfqs?limit=100'),
          api.get('/material-rates?isActive=true'),
          api.get('/machine-rates?isActive=true'),
        ])

      setRfqs(rfqResponse.data.data ?? [])
      setMaterialRates(materialResponse.data.data ?? [])
      setMachineRates(machineResponse.data.data ?? [])
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const loadPartDetails = async (partId: string) => {
    setError('')
    setNotice('')
    setLatestResult(null)
    setHistory([])
    setOperations([])

    if (!partId) return

    try {
      const [routingResponse, historyResponse] = await Promise.all([
        api.get(`/routings/part/${partId}`).catch((err) => {
          if (err.response?.status === 404) return null
          throw err
        }),
        api.get(`/costings/part/${partId}`),
      ])

      const routing = routingResponse?.data?.data

      if (routing?.operations) {
        setOperations(
          routing.operations.map((operation: Operation) => ({
            sequence: operation.sequence,
            operationName: operation.operationName,
            machineRateId: operation.machineRateId,
            cycleTimeMin: Number(operation.cycleTimeMin),
            setupTimeMin: Number(operation.setupTimeMin ?? 0),
          })),
        )
      }

      const records: CostingRecord[] = historyResponse.data.data ?? []
      setHistory(records)
      if (records.length > 0) setLatestResult(records[0])
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  useEffect(() => {
    void loadInitialData()
  }, [])

  useEffect(() => {
    if (selectedPartId) void loadPartDetails(selectedPartId)
  }, [selectedPartId])

  const handleRFQChange = (rfqId: string) => {
    setSelectedRFQId(rfqId)
    setSelectedPartId('')
    setLatestResult(null)
    setHistory([])
    setOperations([])
  }

  const handleAssignMaterialRate = async (materialRateId: string) => {
    if (!selectedPart) return

    setError('')
    setNotice('')

    try {
      await api.patch(`/parts/${selectedPart.id}/material-rate`, {
        materialRateId,
      })

      setRfqs((current) =>
        current.map((rfq) => ({
          ...rfq,
          parts: rfq.parts.map((part) =>
            part.id === selectedPart.id
              ? {
                  ...part,
                  materialRateId,
                  materialRate: materialRates.find(
                    (rate) => rate.id === materialRateId,
                  ) ?? null,
                }
              : part,
          ),
        })),
      )

      setNotice('Material rate assigned successfully.')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const addOperation = () => {
    setOperations((current) => [
      ...current,
      {
        sequence: current.length + 1,
        operationName: '',
        machineRateId: '',
        cycleTimeMin: 1,
        setupTimeMin: 0,
      },
    ])
  }

  const updateOperation = (
    index: number,
    field: keyof Operation,
    value: string | number,
  ) => {
    setOperations((current) =>
      current.map((operation, i) =>
        i === index ? { ...operation, [field]: value } : operation,
      ),
    )
  }

  const removeOperation = (index: number) => {
    setOperations((current) =>
      current
        .filter((_, i) => i !== index)
        .map((operation, i) => ({ ...operation, sequence: i + 1 })),
    )
  }

  const saveRouting = async () => {
    if (!selectedPart) return

    if (
      operations.length === 0 ||
      operations.some(
        (operation) =>
          !operation.operationName.trim() ||
          !operation.machineRateId ||
          operation.cycleTimeMin <= 0,
      )
    ) {
      setError('Complete every routing operation before saving.')
      return
    }

    setError('')
    setNotice('')

    try {
      await api.put(`/routings/part/${selectedPart.id}`, {
        name: 'Standard machining',
        operations: operations.map((operation, index) => ({
          ...operation,
          sequence: index + 1,
        })),
      })

      setNotice('Routing saved successfully.')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const handleGenerateCosting = async () => {
    if (!selectedPart) return

    if (!selectedPart.materialRateId) {
      setError('Assign a material rate before generating costing.')
      return
    }

    if (operations.length === 0) {
      setError('Add and save routing operations before generating costing.')
      return
    }

    const volumes = annualVolumes
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)

    if (volumes.length === 0 || volumes.length > 5) {
      setError('Enter between one and five valid annual volumes, separated by commas.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    try {
      const idempotencyKey = crypto.randomUUID()

      const response = await api.post(
        '/costings',
        {
          partId: selectedPart.id,
          scrapPercentage,
          overheadAmount,
          packingAmount,
          freightAmount,
          profitMargin,
          annualVolumes: volumes,
          assumptions: assumptions.trim() || undefined,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        },
      )

      const savedCosting: CostingRecord = response.data.data.costing

      setLatestResult(savedCosting)
      setHistory((current) => [
        savedCosting,
        ...current.filter((record) => record.id !== savedCosting.id),
      ])

      setNotice('Costing generated and saved successfully.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const selectHistoryRecord = (record: CostingRecord) => {
    setLatestResult(record)
  }

  if (loading) {
    return (
      <section className="costing-page">
        <div className="costing-loading">Loading costing workspace...</div>
      </section>
    )
  }

  return (
    <section className="costing-page">
      <header className="costing-header">
        <div>
          <span className="costing-eyebrow">ESTIMATION WORKSPACE</span>
          <h1>Part Costing</h1>
          <p>Configure material, machining and commercial costs for each RFQ part.</p>
        </div>

        <button
          className="costing-secondary-button"
          onClick={() => void loadInitialData()}
        >
          <RefreshCw size={16} />
          Refresh data
        </button>
      </header>

      {error && <div className="costing-alert costing-alert-error">{error}</div>}
      {notice && <div className="costing-alert costing-alert-success">{notice}</div>}

      <div className="costing-selection-grid">
        <label className="costing-field">
          <span>Select RFQ</span>
          <select
            value={selectedRFQId}
            onChange={(event) => handleRFQChange(event.target.value)}
          >
            <option value="">Choose an RFQ</option>
            {rfqs.map((rfq) => (
              <option key={rfq.id} value={rfq.id}>
                {rfq.rfqNumber} — {rfq.customer?.name ?? 'Unknown customer'}
              </option>
            ))}
          </select>
        </label>

        <label className="costing-field">
          <span>Select part</span>
          <select
            value={selectedPartId}
            onChange={(event) => setSelectedPartId(event.target.value)}
            disabled={!selectedRFQ}
          >
            <option value="">Choose a part</option>
            {selectedRFQ?.parts.map((part) => (
              <option key={part.id} value={part.id}>
                {part.partNumber ? `${part.partNumber} — ` : ''}
                {part.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedPart ? (
        <div className="costing-empty">
          <Calculator size={30} />
          <h3>Select an RFQ part to begin</h3>
          <p>Its material, routing and costing information will appear here.</p>
        </div>
      ) : (
        <>
          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">SELECTED PART</span>
                <h2>{selectedPart.name}</h2>
              </div>
              <span className="costing-part-id">
                {selectedPart.partNumber || selectedPart.id}
              </span>
            </div>

            <div className="costing-part-facts">
              <div>
                <span>Material grade</span>
                <strong>{selectedPart.materialGrade || 'Not specified'}</strong>
              </div>
              <div>
                <span>Gross weight</span>
                <strong>
                  {selectedPart.grossWeightKg
                    ? `${selectedPart.grossWeightKg} kg`
                    : 'Not specified'}
                </strong>
              </div>
              <div>
                <span>Annual volume</span>
                <strong>
                  {selectedPart.annualVolume?.toLocaleString('en-IN') ?? 'Not specified'}
                </strong>
              </div>
              <div>
                <span>Drawing number</span>
                <strong>{selectedPart.drawingNumber || 'Not specified'}</strong>
              </div>
            </div>
          </section>

          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">STEP 1</span>
                <h2>Material rate</h2>
              </div>
            </div>

            <label className="costing-field">
              <span>Assign material rate</span>
              <select
                value={selectedPart.materialRateId ?? ''}
                onChange={(event) =>
                  void handleAssignMaterialRate(event.target.value)
                }
              >
                <option value="">Select a matching material rate</option>
                {matchingMaterialRates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    {rate.materialCode} — {rate.grade} — {money(rate.ratePerKg)}/kg
                  </option>
                ))}
              </select>
            </label>

            {selectedPart.materialRate && (
              <p className="costing-inline-info">
                Assigned: {selectedPart.materialRate.materialCode} at{' '}
                {money(selectedPart.materialRate.ratePerKg)}/kg
              </p>
            )}

            {matchingMaterialRates.length === 0 && (
              <p className="costing-muted">
                No currently effective material rate matches this part's material grade.
              </p>
            )}
          </section>

          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">STEP 2</span>
                <h2>Routing operations</h2>
              </div>
              <button className="costing-secondary-button" onClick={addOperation}>
                <Plus size={16} />
                Add operation
              </button>
            </div>

            {operations.length === 0 ? (
              <p className="costing-muted">
                No routing configured. Add the machining operations for this part.
              </p>
            ) : (
              <div className="costing-operation-list">
                {operations.map((operation, index) => (
                  <div className="costing-operation-row" key={index}>
                    <span className="costing-operation-number">{index + 1}</span>

                    <label className="costing-field">
                      <span>Operation</span>
                      <input
                        value={operation.operationName}
                        onChange={(event) =>
                          updateOperation(index, 'operationName', event.target.value)
                        }
                        placeholder="e.g. CNC Turning"
                      />
                    </label>

                    <label className="costing-field">
                      <span>Machine rate</span>
                      <select
                        value={operation.machineRateId}
                        onChange={(event) =>
                          updateOperation(index, 'machineRateId', event.target.value)
                        }
                      >
                        <option value="">Select machine</option>
                        {availableMachineRates.map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {rate.machineCode} — {rate.machineName} (
                            {money(rate.ratePerHour)}/hr)
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="costing-field">
                      <span>Cycle time (min)</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={operation.cycleTimeMin}
                        onChange={(event) =>
                          updateOperation(index, 'cycleTimeMin', Number(event.target.value))
                        }
                      />
                    </label>

                    <label className="costing-field">
                      <span>Setup time (min)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={operation.setupTimeMin}
                        onChange={(event) =>
                          updateOperation(index, 'setupTimeMin', Number(event.target.value))
                        }
                      />
                    </label>

                    <button
                      className="costing-icon-button"
                      onClick={() => removeOperation(index)}
                      aria-label="Remove operation"
                      title="Remove operation"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="costing-panel-actions">
              <button className="costing-primary-button" onClick={() => void saveRouting()}>
                <Save size={16} />
                Save routing
              </button>
            </div>
          </section>

          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">STEP 3</span>
                <h2>Commercial costing inputs</h2>
              </div>
            </div>

            <div className="costing-input-grid">
              <label className="costing-field">
                <span>Scrap percentage (%)</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={scrapPercentage}
                  onChange={(event) => setScrapPercentage(Number(event.target.value))}
                />
              </label>

              <label className="costing-field">
                <span>Overhead per part (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={overheadAmount}
                  onChange={(event) => setOverheadAmount(Number(event.target.value))}
                />
              </label>

              <label className="costing-field">
                <span>Packing per part (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={packingAmount}
                  onChange={(event) => setPackingAmount(Number(event.target.value))}
                />
              </label>

              <label className="costing-field">
                <span>Freight per part (₹)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={freightAmount}
                  onChange={(event) => setFreightAmount(Number(event.target.value))}
                />
              </label>

              <label className="costing-field">
                <span>Profit margin (%)</span>
                <input
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.1"
                  value={profitMargin}
                  onChange={(event) => setProfitMargin(Number(event.target.value))}
                />
              </label>

              <label className="costing-field">
                <span>Annual volumes (comma separated)</span>
                <input
                  value={annualVolumes}
                  onChange={(event) => setAnnualVolumes(event.target.value)}
                  placeholder="180000, 120000, 60000"
                />
              </label>
            </div>

            <label className="costing-field costing-assumptions">
              <span>Assumptions and notes</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={assumptions}
                onChange={(event) => setAssumptions(event.target.value)}
                placeholder="Record assumptions used for this costing..."
              />
            </label>

            <div className="costing-panel-actions">
              <button
                className="costing-primary-button"
                onClick={() => void handleGenerateCosting()}
                disabled={saving}
              >
                <Calculator size={16} />
                {saving ? 'Generating...' : 'Generate and save costing'}
              </button>
            </div>
          </section>

          {latestResult && (
            <section className="costing-panel">
              <div className="costing-panel-heading">
                <div>
                  <span className="costing-eyebrow">RECURRING COST PER PART (EXCLUDING SETUP)</span>
                  <h2>Version {latestResult.version}</h2>
                </div>
                <span className="costing-result-total" title="Recurring cost per part, excluding batch setup">
                  {money(latestResult.totalCost)}
                </span>
              </div>

              <p className="costing-muted">
                Saved on {new Date(latestResult.createdAt).toLocaleString('en-IN')}
              </p>

              <div className="costing-breakdown">
                {latestResult.components?.map((component, index) => (
                  <div className="costing-breakdown-row" key={component.id ?? index}>
                    <div>
                      <strong>{component.name}</strong>
                      <span>{component.description}</span>
                    </div>
                    <strong>{money(component.amount)}</strong>
                  </div>
                ))}
              </div>

              {latestResult.assumptions && (
                <div className="costing-assumptions-summary">
                  <strong>Saved assumptions</strong>
                  <p>{latestResult.assumptions}</p>
                </div>
              )}

              <h3 className="costing-subheading">Volume-wise selling prices</h3>

              <div className="costing-volume-table">
                <div className="costing-volume-header">
                  <span>Annual volume</span>
                  <span>Unit selling price</span>
                  <span>Annual value</span>
                </div>

                {latestResult.volumes?.map((volume, index) => (
                  <div className="costing-volume-row" key={index}>
                    <strong>{volume.annualVolume.toLocaleString('en-IN')}</strong>
                    <strong>{money(volume.unitPrice)}</strong>
                    <strong>{money(volume.totalCost)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">PREVIOUS RECORDS</span>
                <h2><History size={19} /> Costing history</h2>
              </div>
              <span className="costing-history-count">{history.length} versions</span>
            </div>

            {history.length === 0 ? (
              <p className="costing-muted">No saved costing versions for this part yet.</p>
            ) : (
              <div className="costing-history-list">
                {history.map((record) => (
                  <button
                    className={`costing-history-item ${
                      latestResult?.id === record.id ? 'selected' : ''
                    }`}
                    key={record.id}
                    onClick={() => selectHistoryRecord(record)}
                  >
                    <span>
                      <strong>Version {record.version}</strong>
                      <small>{new Date(record.createdAt).toLocaleDateString('en-IN')}</small>
                    </span>
                    <strong>{money(record.totalCost)}</strong>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}
