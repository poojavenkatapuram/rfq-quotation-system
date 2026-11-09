import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Calculator, RefreshCw, Save, Plus, Trash2, History } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/auth-context'
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

type RoutingRecommendation = {
  sourceRoutingRevision: number
  sourcePartId: string
  sourcePartNumber: string | null
  sourcePartName: string
  sourceMaterialGrade: string | null
  sourceWeightKg: number | null
  sourceRfqNumber: string
  similarityScore: number
  matchingFactors: {
    materialGradeMatch: boolean
    partNameSimilarity: number
    weightSimilarity: number
  }
  operations: Array<{
    sequence: number
    operationName: string
    cycleTimeMin: number
    setupTimeMin: number | null
    machineRateId: string | null
    machineRate: {
      machineCode: string
      machineName: string
      ratePerHour: number
    } | null
  }>
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
  routingRevision?: number | null
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

type InitialCostingData = {
  rfqs: RFQ[]
  materialRates: MaterialRate[]
  machineRates: MachineRate[]
}

type TechnicalReview = {
  id: string
  routingRevision: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  comments: string | null
  submittedAt: string
  reviewedAt: string | null
  reviewedBy?: { name: string } | null
  submittedSnapshot: {
    routing?: { operations?: Array<Operation & { machineRate?: { machineCode: string; machineName: string; ratePerHour: number | string } | null }> }
    saveProvenance?: { recommendationSource?: { sourcePartName?: string; sourceRfqNumber?: string; sourceRoutingRevision?: number } } | null
  }
}

type RoutingState = {
  partId: string
  revision: number
  technicalReviews: TechnicalReview[]
}

type PartCostingData = {
  routing: RoutingState | null
  recommendationError: boolean
  operations: Operation[]
  recommendations: RoutingRecommendation[]
  history: CostingRecord[]
}

const fetchInitialCostingData = async (): Promise<InitialCostingData> => {
  const [rfqResponse, materialResponse, machineResponse] = await Promise.all([
    api.get('/rfqs?limit=100'),
    api.get('/material-rates?isActive=true'),
    api.get('/machine-rates?isActive=true'),
  ])

  return {
    rfqs: rfqResponse.data.data ?? [],
    materialRates: materialResponse.data.data ?? [],
    machineRates: machineResponse.data.data ?? [],
  }
}

const fetchPartCostingData = async (partId: string): Promise<PartCostingData> => {
  const [routingResponse, historyResponse, recommendationResponse] = await Promise.all([
    api.get(`/routings/part/${partId}`).catch((error) => {
      if (error.response?.status === 404) return null
      throw error
    }),
    api.get(`/costings/part/${partId}`),
    api.get(`/routings/recommendations/${partId}`).catch((error) => {
      console.error('Historical routing recommendations unavailable:', error)
      return null
    }),
  ])

  const routing = routingResponse?.data?.data

  return {
    routing: routing ? { ...routing, partId } : null,
    recommendationError: !recommendationResponse,
    operations: routing?.operations
      ? routing.operations.map((operation: Operation) => ({
          sequence: operation.sequence,
          operationName: operation.operationName,
          machineRateId: operation.machineRateId,
          cycleTimeMin: Number(operation.cycleTimeMin),
          setupTimeMin: Number(operation.setupTimeMin ?? 0),
        }))
      : [],
    recommendations: recommendationResponse?.data?.data?.recommendations ?? [],
    history: historyResponse.data.data ?? [],
  }
}

export default function Costing() {
  const { user } = useAuth()
  const canEditRouting = ['ESTIMATOR', 'PLANT_HEAD', 'ADMIN'].includes(user?.role ?? '')
  const canEstimate = ['ESTIMATOR', 'ADMIN'].includes(user?.role ?? '')
  const [routingState, setRoutingState] = useState<RoutingState | null>(null)
  const [loadedPartId, setLoadedPartId] = useState('')
  const [savedOperations, setSavedOperations] = useState<Operation[]>([])
  const [recommendationSource, setRecommendationSource] = useState<{ sourcePartId: string; sourceRoutingRevision: number } | undefined>(undefined)
  const [recommendationError, setRecommendationError] = useState(false)
  const [reviewComments, setReviewComments] = useState('')
  const [routingBusy, setRoutingBusy] = useState(false)
  const [rfqs, setRfqs] = useState<RFQ[]>([])
  const [materialRates, setMaterialRates] = useState<MaterialRate[]>([])
  const [machineRates, setMachineRates] = useState<MachineRate[]>([])
  const [selectedRFQId, setSelectedRFQId] = useState('')
  const [selectedPartId, setSelectedPartId] = useState('')
  const [operations, setOperations] = useState<Operation[]>([])
  const [recommendations, setRecommendations] = useState<RoutingRecommendation[]>([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)

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

  const partLoaded = loadedPartId === selectedPartId && Boolean(selectedPartId)
  const currentRouting = routingState?.partId === selectedPartId ? routingState : null
  const currentReview = currentRouting?.technicalReviews.find(review => review.routingRevision === currentRouting.revision)
  const routingDirty = JSON.stringify(operations) !== JSON.stringify(savedOperations)

  const availableMaterialRates = useMemo(
    () => materialRates.filter(isCurrentlyEffective),
    [materialRates],
  )

  const availableMachineRates = useMemo(
    () => machineRates.filter(isCurrentlyEffective),
    [machineRates],
  )

  const matchingMaterialRates = selectedPart?.materialGrade
    ? availableMaterialRates.filter(
        (rate) =>
          rate.grade.trim().toLowerCase() ===
          selectedPart.materialGrade?.trim().toLowerCase(),
      )
    : []

  const loadInitialData = async () => {
    if (routingDirty && partLoaded) {
      setError('Save your routing edits before refreshing, or select the part again to reload the saved version.')
      return
    }
    setLoading(true)
    setError('')

    try {
      const data = await fetchInitialCostingData()
      setRfqs(data.rfqs)
      setMaterialRates(data.materialRates)
      setMachineRates(data.machineRates)
      if (selectedPartId) {
        const partData = await fetchPartCostingData(selectedPartId)
        setOperations(partData.operations)
        setSavedOperations(partData.operations)
        setRoutingState(partData.routing)
        setLoadedPartId(selectedPartId)
        setRecommendationSource(undefined)
        setRecommendationError(partData.recommendationError)
        setRecommendations(partData.recommendations)
        setHistory(partData.history)
        setLatestResult(partData.history[0] ?? null)
        setReviewComments('')
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isCurrent = true

    const loadInitialCostingData = async () => {
      try {
        const data = await fetchInitialCostingData()

        if (!isCurrent) return

        setRfqs(data.rfqs)
        setMaterialRates(data.materialRates)
        setMachineRates(data.machineRates)
      } catch (error) {
        if (isCurrent) setError(getErrorMessage(error))
      } finally {
        if (isCurrent) setLoading(false)
      }
    }

    void loadInitialCostingData()

    return () => {
      isCurrent = false
    }
  }, [])

  useEffect(() => {
    if (!selectedPartId) return

    let isCurrent = true

    const loadSelectedPart = async () => {
      try {
        const data = await fetchPartCostingData(selectedPartId)

        if (!isCurrent) return

        setOperations(data.operations)
        setSavedOperations(data.operations)
        setRoutingState(data.routing)
        setLoadedPartId(selectedPartId)
        setRecommendationSource(undefined)
        setReviewComments('')
        setRecommendationError(data.recommendationError)
        setRecommendations(data.recommendations)
        setHistory(data.history)
        setLatestResult(data.history[0] ?? null)
      } catch (error) {
        if (isCurrent) setError(getErrorMessage(error))
      } finally {
        if (isCurrent) setRecommendationsLoading(false)
      }
    }

    void loadSelectedPart()

    return () => {
      isCurrent = false
    }
  }, [selectedPartId])

  const handleRFQChange = (rfqId: string) => {
    setLoadedPartId('')
    setSelectedRFQId(rfqId)
    setSelectedPartId('')
    setLatestResult(null)
    setHistory([])
    setOperations([])
  }

  const handlePartChange = (partId: string) => {
    setLoadedPartId('')
    setSelectedPartId(partId)
    setError('')
    setNotice('')
    setLatestResult(null)
    setHistory([])
    setOperations([])
    setRecommendations([])
    setRecommendationsLoading(Boolean(partId))
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

  const applyRecommendation = (recommendation: RoutingRecommendation) => {
    const mappedOperations = recommendation.operations.map((operation, index) => {
      const machineRate = availableMachineRates.find(
        (rate) => rate.id === operation.machineRateId,
      )

      return {
        sequence: index + 1,
        operationName: operation.operationName,
        machineRateId: machineRate?.id ?? '',
        cycleTimeMin: operation.cycleTimeMin,
        setupTimeMin: operation.setupTimeMin ?? 0,
      }
    })

    setRecommendationSource({ sourcePartId: recommendation.sourcePartId, sourceRoutingRevision: recommendation.sourceRoutingRevision })
    setOperations(mappedOperations)
    setNotice(
      'Historical routing copied for review. Verify machine rates and timings, then save the routing.',
    )
    setError('')
  }

  const saveRouting = async () => {
    if (!selectedPart || !partLoaded || routingBusy) return

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

    setRoutingBusy(true)
    try {
      const response = await api.put(`/routings/part/${selectedPart.id}`, {
        expectedRevision: currentRouting?.revision ?? 0,
        recommendationSource,
        name: 'Standard machining',
        operations: operations.map((operation, index) => ({
          ...operation,
          sequence: index + 1,
        })),
      })

      setRoutingState({ ...response.data.data, partId: selectedPart.id, technicalReviews: currentRouting?.technicalReviews ?? [] })
      setSavedOperations(operations)
      setRecommendationSource(undefined)
      setNotice('New routing revision saved as draft. Submit it for Plant Head technical review.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRoutingBusy(false)
    }
  }

  const handleReview = async (status?: 'APPROVED' | 'REJECTED') => {
    if (!selectedPart || !currentRouting || !partLoaded || routingDirty || routingBusy) return
    if (status === 'REJECTED' && !reviewComments.trim()) {
      setError('Enter comments explaining the requested changes.')
      return
    }
    setRoutingBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await api.post(`/routings/part/${selectedPart.id}/review${status ? '/decision' : ''}`, {
        expectedRevision: currentRouting.revision,
        ...(status ? { status, comments: reviewComments.trim() } : {}),
      })
      const review: TechnicalReview = response.data.data
      setRoutingState({ ...currentRouting, technicalReviews: [review, ...currentRouting.technicalReviews.filter(item => item.id !== review.id)] })
      setReviewComments('')
      setNotice(status === 'REJECTED' ? 'Changes requested. Save a new routing revision before resubmitting.' : status === 'APPROVED' ? 'Technical review approved. Sales Head commercial approval remains separate.' : 'Routing submitted for Plant Head technical review.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRoutingBusy(false)
    }
  }

  const handleGenerateCosting = async () => {
    if (!selectedPart || !partLoaded || routingDirty || !currentRouting) return

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
          disabled={routingBusy || saving}
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
            disabled={routingBusy || saving}
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
            onChange={(event) => handlePartChange(event.target.value)}
            disabled={!selectedRFQ || routingBusy || saving}
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

          {!partLoaded && <p role="status">Loading routing and review status...</p>}
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
                disabled={!canEditRouting || !partLoaded || routingBusy}
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
              <button className="costing-secondary-button" disabled={!canEditRouting || !partLoaded || routingBusy} onClick={addOperation}>
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
                        disabled={!canEditRouting || !partLoaded || routingBusy}
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
                        disabled={!canEditRouting || !partLoaded || routingBusy}
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
                        disabled={!canEditRouting || !partLoaded || routingBusy}
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
                        disabled={!canEditRouting || !partLoaded || routingBusy}
                        value={operation.setupTimeMin}
                        onChange={(event) =>
                          updateOperation(index, 'setupTimeMin', Number(event.target.value))
                        }
                      />
                    </label>

                    <button
                      className="costing-icon-button"
                      disabled={!canEditRouting || !partLoaded || routingBusy}
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
              <button className="costing-primary-button" disabled={!canEditRouting || !partLoaded || routingBusy} onClick={() => void saveRouting()}>
                <Save size={16} />
                Save routing
              </button>
            </div>
          </section>

          <section className="costing-panel" aria-label="Plant Head technical review">
            <h2>Plant Head technical review</h2>
            <p role="status">{partLoaded ? `Routing revision ${currentRouting?.revision ?? 'not saved'} · ${currentReview?.status === 'REJECTED' ? 'Changes requested' : currentReview?.status ?? 'Draft'}` : 'Loading review status...'}</p>
            <p className="costing-muted">Draft costings can be saved before approval. The current routing revision must be approved by a Plant Head before quotation submission or sending. Sales Head commercial approval is separate.</p>
            {routingDirty && <p role="status">Unsaved routing changes. Save a new revision before review or costing.</p>}
            {currentReview?.comments && <p>Review comments: {currentReview.comments}</p>}
            {canEstimate && <button className="costing-primary-button" disabled={!partLoaded || !currentRouting || Boolean(currentReview) || routingDirty || routingBusy} onClick={() => void handleReview()}>Submit for technical review</button>}
            {user?.role === 'PLANT_HEAD' && currentReview?.status === 'PENDING' && <>
              <label className="costing-field"><span>Technical review comments (required to request changes)</span><textarea maxLength={2000} value={reviewComments} onChange={event => setReviewComments(event.target.value)} disabled={routingBusy} /></label>
              <div className="costing-panel-actions">
                <button className="costing-primary-button" disabled={!partLoaded || routingDirty || routingBusy} onClick={() => void handleReview('APPROVED')}>Approve technical routing</button>
                <button className="costing-secondary-button" disabled={!partLoaded || routingDirty || routingBusy || !reviewComments.trim()} onClick={() => void handleReview('REJECTED')}>Request changes</button>
              </div>
            </>}
            {currentReview?.status === 'REJECTED' && <p>Save a new revision, then submit it for review.</p>}
            <details><summary>Technical review history ({currentRouting?.technicalReviews.length ?? 0})</summary>
              {currentRouting?.technicalReviews.map(review => <article key={review.id}>
                <h3>Revision {review.routingRevision} · {review.status === 'REJECTED' ? 'Changes requested' : review.status}</h3>
                <p>Submitted {new Date(review.submittedAt).toLocaleString('en-IN')}{review.reviewedAt ? ` · Reviewed ${new Date(review.reviewedAt).toLocaleString('en-IN')} by ${review.reviewedBy?.name ?? 'Plant Head'}` : ''}</p>
                {review.comments && <p>{review.comments}</p>}
                {review.submittedSnapshot?.routing?.operations?.map((operation, index) => <p key={index}>{operation.sequence}. {operation.operationName} · {operation.machineRate ? `${operation.machineRate.machineCode} — ${operation.machineRate.machineName} (${money(operation.machineRate.ratePerHour)}/hr at submission)` : 'Machine rate not recorded'} · Cycle {Number(operation.cycleTimeMin)} min · Setup {Number(operation.setupTimeMin ?? 0)} min</p>)}
                {review.submittedSnapshot?.saveProvenance?.recommendationSource && <p>Historical source: {review.submittedSnapshot.saveProvenance.recommendationSource.sourcePartName} · RFQ {review.submittedSnapshot.saveProvenance.recommendationSource.sourceRfqNumber} · Routing revision {review.submittedSnapshot.saveProvenance.recommendationSource.sourceRoutingRevision}</p>}
              </article>)}
            </details>
          </section>

          <section className="costing-panel">
            <div className="costing-panel-heading">
              <div>
                <span className="costing-eyebrow">HISTORICAL REFERENCE</span>
                <h2>Similar part routings</h2>
                <p className="costing-muted">
                  Historical similarity ranking, not an AI prediction. Review every
                  suggested operation before saving.
                </p>
              </div>
            </div>

            {recommendationsLoading ? (
              <p className="costing-muted">Searching historical routings...</p>
            ) : recommendationError ? (
              <p role="alert">Historical recommendations could not be loaded. Select the part again to retry.</p>
            ) : recommendations.length === 0 ? (
              <p className="costing-muted">
                No historical parts with saved routing operations were found.
              </p>
            ) : (
              <div className="costing-operation-list">
                {recommendations.map((recommendation) => (
                  <article
                    key={recommendation.sourcePartId}
                    className="costing-panel"
                  >
                    <div className="costing-panel-heading">
                      <div>
                        <h3>{recommendation.sourcePartName}</h3>
                        <p className="costing-muted">
                          Source RFQ: {recommendation.sourceRfqNumber}
                          {recommendation.sourcePartNumber
                            ? ` · Part: ${recommendation.sourcePartNumber}`
                            : ''}
                        </p>
                      </div>
                      <strong>{recommendation.similarityScore}% match</strong>
                    </div>

                    <p className="costing-muted">
                      Material: {recommendation.sourceMaterialGrade || 'Not recorded'}
                      {' · '}
                      Weight: {recommendation.sourceWeightKg ?? 'Not recorded'} kg
                      {' · '}
                      Material match: {recommendation.matchingFactors.materialGradeMatch ? 'Yes' : 'No'}
                      {' · '}
                      Name similarity: {recommendation.matchingFactors.partNameSimilarity}%
                    </p>

                    <div className="costing-operation-list">
                      {recommendation.operations.map((operation) => {
                        const currentRate = availableMachineRates.find(
                          (rate) => rate.id === operation.machineRateId,
                        )

                        return (
                          <div
                            className="costing-operation-row"
                            key={`${recommendation.sourcePartId}-${operation.sequence}`}
                          >
                            <span className="costing-operation-number">
                              {operation.sequence}
                            </span>
                            <div>
                              <strong>{operation.operationName}</strong>
                              <p className="costing-muted">
                                {operation.cycleTimeMin} min cycle ·{' '}
                                {operation.setupTimeMin ?? 0} min setup
                              </p>
                            </div>
                            <div>
                              <strong>
                                {operation.machineRate
                                  ? `${operation.machineRate.machineCode} — ${operation.machineRate.machineName}`
                                  : 'Machine rate unavailable'}
                              </strong>
                              <p className="costing-muted">
                                {currentRate
                                  ? `${money(currentRate.ratePerHour)}/hr · currently effective`
                                  : 'Historical rate unavailable or no longer effective'}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div className="costing-panel-actions">
                      <button
                        className="costing-secondary-button"
                        disabled={!canEditRouting || !partLoaded || routingBusy}
                        onClick={() => applyRecommendation(recommendation)}
                      >
                        Use this routing for review
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
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
                disabled={saving || !canEstimate || !partLoaded || !currentRouting || routingDirty || routingBusy}
              >
                <Calculator size={16} />
                {saving ? 'Generating...' : 'Generate and save draft costing'}
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
                Saved on {new Date(latestResult.createdAt).toLocaleString('en-IN')} · Routing revision {latestResult.routingRevision ?? 'not recorded (legacy costing)'}
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
