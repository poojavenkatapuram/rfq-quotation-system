export type CostBreakdownSnapshot = {
  materialCost: number
  machiningCost: number
  setupCostPerPart: number
  scrapCost: number
  overheadCost: number
  packingCost: number
  freightCost: number
  unitCost: number
}

export type ApprovedQuotationPartSnapshot = {
  partNumber: string | null
  partName: string
  description: string | null
  materialGrade: string | null
  revision: string | null
  annualVolume: number
  unitSellingPrice: number
  lineTotal: number
  costBreakdown: CostBreakdownSnapshot
  profitMarginPercentage: number | null
  costingAssumptions: string | null
  costingVersion: number | null
  provenance?: CostingProvenanceSnapshot
}

export type CostingProvenanceSnapshot = {
  drawingNumber: string | null
  material: {
    rateId: string
    ratePerKg: number
    currency: "INR"
    grossWeightKg: number
  }
  costing: {
    version: number
    recurringTotal: number
    setupTotal: number
    scrapPercentage: number
    profitMarginPercentage: number
    overheadAmount: number
    packingAmount: number
    freightAmount: number
    assumptions: string | null
  }
  operations: Array<{
    operationName: string
    machineRateId: string
    machineRatePerHour: number
    currency: "INR"
    cycleTimeMin: number
    machiningCost: number
    setupTimeMin: number
    setupCost: number
  }>
}

type SnapshotCore = {
  quotationNumber: string
  quotationDate: string
  validUntil: string | null
  company: {
    name: string | null
    address: string | null
    email: string | null
    phone: string | null
    gstNumber: string | null
  }
  customer: {
    name: string
    address: string | null
    email: string | null
    phone: string | null
    gstNumber: string | null
  }
  rfqNumber: string
  terms: {
    paymentTerms: string | null
    deliveryTerms: string | null
    commercialTerms: string | null
    notes: string | null
  }
  parts: ApprovedQuotationPartSnapshot[]
  totals: {
    subtotal: number
    gstPercentage: number
    gstAmount: number
    grandTotal: number
  }
  approval: {
    status: "APPROVED"
    approvalMode: "AUTOMATIC_THRESHOLD" | "SALES_HEAD"
    approvedAt: string
    approverName: string | null
    approverRole: string | null
  }
}

export type ApprovedQuotationSnapshot = SnapshotCore & {
  schemaVersion: 1 | 2
}

type CurrentApprovedQuotationSnapshot = SnapshotCore & {
  schemaVersion: 2
  parts: Array<ApprovedQuotationPartSnapshot & {
    provenance: CostingProvenanceSnapshot
  }>
}

type SnapshotSource = {
  quotationNumber: string
  createdAt: Date
  validUntil: Date | null
  paymentTerms: string | null
  deliveryTerms: string | null
  commercialTerms: string | null
  notes: string | null
  subtotal: unknown
  gstPercentage: unknown
  gstAmount: unknown
  grandTotal: unknown
  customer: {
    name: string
    address: string | null
    email: string | null
    phone: string | null
    gstNumber: string | null
  }
  rfq: { rfqNumber: string }
  parts: Array<{
    quantity: number
    unitPrice: unknown
    totalPrice: unknown
    part: {
      partNumber: string | null
      name: string
      description: string | null
      materialGrade: string | null
      revision?: string | null
      drawingNumber?: string | null
    }
    costing: null | {
      version: number
      totalCost?: unknown
      materialRateId?: string | null
      materialRatePerKgSnapshot?: unknown
      grossWeightKg?: unknown
      scrapPercentage?: unknown
      overheadAmount?: unknown
      packingAmount?: unknown
      freightAmount?: unknown
      profitMargin: unknown
      assumptions: string | null
      components: Array<{
        type: string
        amount: unknown
        name?: string
        machineRateId?: string | null
        cycleTimeMin?: unknown
        setupTimeMinSnapshot?: unknown
        ratePerHourSnapshot?: unknown
      }>
    }
  }>
}

const money = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0
}

const requiredNumber = (value: unknown, label: string): number => {
  if (
    value === null || value === undefined || typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "")
  ) {
    throw new Error(`Invalid snapshot field: ${label}`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid snapshot field: ${label}`)
  return parsed
}

const requiredText = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid snapshot field: ${label}`)
  }
  return value.trim()
}

const text = (value: string | undefined): string | null => {
  const normalized = value?.trim()
  return normalized || null
}

export const companyConfiguration = (): ApprovedQuotationSnapshot["company"] => ({
  name: text(process.env.COMPANY_NAME),
  address: text(process.env.COMPANY_ADDRESS),
  email: text(process.env.COMPANY_EMAIL),
  phone: text(process.env.COMPANY_PHONE),
  gstNumber: text(process.env.COMPANY_GST_NUMBER),
})

const componentTotal = (
  components: Array<{ type: string; amount: unknown }>,
  type: string,
): number =>
  money(
    components
      .filter((component) => component.type === type)
      .reduce((total, component) => total + Number(component.amount || 0), 0),
  )

const buildCostingProvenance = (
  line: SnapshotSource["parts"][number],
): CostingProvenanceSnapshot => {
  const costing = line.costing
  if (!costing) throw new Error("Approved snapshots require saved costing provenance")

  const machiningComponents = costing.components.filter(
    (component) => component.type === "MACHINING",
  )
  const setupComponents = costing.components.filter(
    (component) => component.type === "SETUP",
  )
  const consumedSetups = new Set<number>()
  const operations = machiningComponents.map((component) => {
    const setupIndex = setupComponents.findIndex((setup, index) =>
      !consumedSetups.has(index) &&
      setup.machineRateId === component.machineRateId &&
      setup.name === `${component.name} setup`,
    )
    const setup = setupIndex >= 0 ? setupComponents[setupIndex] : undefined
    if (setupIndex >= 0) consumedSetups.add(setupIndex)

    return {
      operationName: requiredText(component.name, "operation name"),
      machineRateId: requiredText(component.machineRateId, "machine rate ID"),
      machineRatePerHour: money(component.ratePerHourSnapshot),
      currency: "INR" as const,
      cycleTimeMin: requiredNumber(component.cycleTimeMin, "cycle time"),
      machiningCost: money(component.amount),
      setupTimeMin: setup ? requiredNumber(setup.setupTimeMinSnapshot, "setup time") : 0,
      setupCost: setup ? money(setup.amount) : 0,
    }
  })

  if (operations.length === 0) {
    throw new Error("Approved snapshots require saved routing operation provenance")
  }

  return {
    drawingNumber: line.part.drawingNumber ?? null,
    material: {
      rateId: requiredText(costing.materialRateId, "material rate ID"),
      ratePerKg: money(costing.materialRatePerKgSnapshot),
      currency: "INR",
      grossWeightKg: requiredNumber(costing.grossWeightKg, "gross weight"),
    },
    costing: {
      version: costing.version,
      recurringTotal: money(costing.totalCost),
      setupTotal: componentTotal(costing.components, "SETUP"),
      scrapPercentage: requiredNumber(costing.scrapPercentage, "scrap percentage"),
      profitMarginPercentage: requiredNumber(costing.profitMargin, "profit margin"),
      overheadAmount: money(costing.overheadAmount),
      packingAmount: money(costing.packingAmount),
      freightAmount: money(costing.freightAmount),
      assumptions: costing.assumptions,
    },
    operations,
  }
}

const buildPartSnapshot = (
  line: SnapshotSource["parts"][number],
): ApprovedQuotationPartSnapshot & { provenance: CostingProvenanceSnapshot } => {
  const components = line.costing?.components ?? []
  requiredNumber(line.quantity, "annual volume")
  requiredNumber(line.unitPrice, "unit selling price")
  requiredNumber(line.totalPrice, "line total")
  for (const component of components) {
    const amount = requiredNumber(component.amount, `${component.type} component amount`)
    if (amount < 0) throw new Error(`Invalid snapshot field: ${component.type} component amount`)
  }
  if (line.costing) {
    requiredNumber(line.costing.totalCost, "recurring costing total")
    requiredNumber(line.costing.materialRatePerKgSnapshot, "material rate snapshot")
    requiredNumber(line.costing.overheadAmount, "overhead amount")
    requiredNumber(line.costing.packingAmount, "packing amount")
    requiredNumber(line.costing.freightAmount, "freight amount")
    requiredNumber(line.costing.profitMargin, "profit margin")
  }
  const materialCost = componentTotal(components, "MATERIAL")
  const machiningCost = componentTotal(components, "MACHINING")
  const setupCostPerPart = line.quantity > 0
    ? money(componentTotal(components, "SETUP") / line.quantity)
    : 0
  const scrapCost = componentTotal(components, "SCRAP")
  const overheadCost = componentTotal(components, "OVERHEAD")
  const packingCost = componentTotal(components, "PACKING")
  const freightCost = componentTotal(components, "FREIGHT")
  const recurringCostFromComponents = money(
    materialCost + machiningCost + scrapCost + overheadCost +
    packingCost + freightCost,
  )
  const recurringCost = line.costing?.totalCost === undefined
    ? recurringCostFromComponents
    : money(line.costing.totalCost)
  const unitCost = money(
    recurringCost + setupCostPerPart,
  )

  return {
    partNumber: line.part.partNumber,
    partName: line.part.name,
    description: line.part.description,
    materialGrade: line.part.materialGrade,
    revision: line.part.revision ?? null,
    annualVolume: line.quantity,
    unitSellingPrice: money(line.unitPrice),
    lineTotal: money(line.totalPrice),
    costBreakdown: {
      materialCost,
      machiningCost,
      setupCostPerPart,
      scrapCost,
      overheadCost,
      packingCost,
      freightCost,
      unitCost,
    },
    profitMarginPercentage: line.costing
      ? requiredNumber(line.costing.profitMargin, "profit margin")
      : null,
    costingAssumptions: line.costing?.assumptions ?? null,
    costingVersion: line.costing?.version ?? null,
    provenance: buildCostingProvenance(line),
  }
}

export const buildApprovedQuotationSnapshot = (
  quotation: SnapshotSource,
  approval: {
    mode: "AUTOMATIC_THRESHOLD" | "SALES_HEAD"
    approvedAt: Date
    approverName?: string | null
    approverRole?: string | null
  },
  company: ApprovedQuotationSnapshot["company"] = companyConfiguration(),
): CurrentApprovedQuotationSnapshot => {
  requiredText(quotation.quotationNumber, "quotation number")
  requiredText(quotation.rfq.rfqNumber, "RFQ number")
  requiredText(quotation.customer.name, "customer name")
  if (!(quotation.createdAt instanceof Date) || !Number.isFinite(quotation.createdAt.getTime())) {
    throw new Error("Invalid snapshot field: quotation date")
  }
  if (!(approval.approvedAt instanceof Date) || !Number.isFinite(approval.approvedAt.getTime())) {
    throw new Error("Invalid snapshot field: approval date")
  }
  requiredNumber(quotation.subtotal, "subtotal")
  requiredNumber(quotation.gstPercentage, "GST percentage")
  requiredNumber(quotation.gstAmount, "GST amount")
  requiredNumber(quotation.grandTotal, "grand total")

  const snapshot: CurrentApprovedQuotationSnapshot = {
    schemaVersion: 2,
    quotationNumber: quotation.quotationNumber,
    quotationDate: quotation.createdAt.toISOString(),
    validUntil: quotation.validUntil?.toISOString() ?? null,
    company: { ...company },
    customer: quotation.customer,
    rfqNumber: quotation.rfq.rfqNumber,
    terms: {
      paymentTerms: quotation.paymentTerms,
      deliveryTerms: quotation.deliveryTerms,
      commercialTerms: quotation.commercialTerms,
      notes: quotation.notes,
    },
    parts: quotation.parts.map(buildPartSnapshot),
    totals: {
      subtotal: money(quotation.subtotal),
      gstPercentage: requiredNumber(quotation.gstPercentage, "GST percentage"),
      gstAmount: money(quotation.gstAmount),
      grandTotal: money(quotation.grandTotal),
    },
    approval: {
      status: "APPROVED",
      approvalMode: approval.mode,
      approvedAt: approval.approvedAt.toISOString(),
      approverName: approval.approverName ?? null,
      approverRole: approval.approverRole ?? null,
    },
  }

  if (!isApprovedQuotationSnapshot(snapshot)) {
    throw new Error("APPROVED_SNAPSHOT_INVALID")
  }
  return snapshot
}

const validDate = (value: unknown): boolean =>
  typeof value === "string" && Number.isFinite(Date.parse(value))

const isNonNegativeMoney = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0

const isCurrentSnapshotValid = (
  snapshot: Record<string, unknown>,
): boolean => {
  const customer = snapshot.customer as Record<string, unknown> | null
  const terms = snapshot.terms as Record<string, unknown> | null
  const totals = snapshot.totals as Record<string, unknown> | null
  const approval = snapshot.approval as Record<string, unknown> | null
  const parts = snapshot.parts

  if (
    !requiredSnapshotText(snapshot.quotationNumber) ||
    !validDate(snapshot.quotationDate) ||
    !requiredSnapshotText(snapshot.rfqNumber) ||
    !customer || !requiredSnapshotText(customer.name) ||
    !terms || !totals || !approval ||
    approval.status !== "APPROVED" ||
    !["AUTOMATIC_THRESHOLD", "SALES_HEAD"].includes(String(approval.approvalMode)) ||
    !validDate(approval.approvedAt) ||
    !Array.isArray(parts) || parts.length === 0
  ) return false

  const normalizedParts: Array<{ quantity: number; unitPrice: number; lineTotal: number }> = []
  for (const rawPart of parts) {
    if (!rawPart || typeof rawPart !== "object") return false
    const part = rawPart as Record<string, unknown>
    const breakdown = part.costBreakdown as Record<string, unknown> | null
    const provenance = part.provenance as Record<string, any> | null
    const quantity = part.annualVolume
    const unitPrice = part.unitSellingPrice
    const lineTotal = part.lineTotal

    if (
      !requiredSnapshotText(part.partName) ||
      !Number.isInteger(quantity) || Number(quantity) <= 0 ||
      !isNonNegativeMoney(unitPrice) || Number(unitPrice) <= 0 ||
      !isNonNegativeMoney(lineTotal) ||
      !breakdown || !provenance
    ) return false

    if (money(Number(unitPrice) * Number(quantity)) !== lineTotal) return false

    const breakdownFields = [
      "materialCost", "machiningCost", "setupCostPerPart", "scrapCost",
      "overheadCost", "packingCost", "freightCost", "unitCost",
    ]
    if (breakdownFields.some((field) => !isNonNegativeMoney(breakdown[field]))) return false

    const costing = provenance.costing as Record<string, unknown> | null
    const material = provenance.material as Record<string, unknown> | null
    const operations = provenance.operations
    if (
      !costing || !material || !Array.isArray(operations) || operations.length === 0 ||
      !Number.isInteger(costing.version) || Number(costing.version) < 1 ||
      !isNonNegativeMoney(costing.recurringTotal) ||
      !isNonNegativeMoney(costing.setupTotal) ||
      !isNonNegativeMoney(costing.scrapPercentage) ||
      !isNonNegativeMoney(costing.profitMarginPercentage) ||
      Number(costing.scrapPercentage) > 100 ||
      Number(costing.profitMarginPercentage) >= 100 ||
      !isNonNegativeMoney(costing.overheadAmount) ||
      !isNonNegativeMoney(costing.packingAmount) ||
      !isNonNegativeMoney(costing.freightAmount) ||
      !requiredSnapshotText(material.rateId) ||
      !isNonNegativeMoney(material.ratePerKg) || Number(material.ratePerKg) <= 0 ||
      material.currency !== "INR" ||
      !isNonNegativeMoney(material.grossWeightKg) || Number(material.grossWeightKg) <= 0
    ) return false

    let machiningPaise = 0
    let setupPaise = 0
    for (const rawOperation of operations) {
      if (!rawOperation || typeof rawOperation !== "object") return false
      const operation = rawOperation as Record<string, unknown>
      if (
        !requiredSnapshotText(operation.operationName) ||
        !requiredSnapshotText(operation.machineRateId) ||
        !isNonNegativeMoney(operation.machineRatePerHour) ||
        Number(operation.machineRatePerHour) <= 0 ||
        operation.currency !== "INR" ||
        !Number.isFinite(operation.cycleTimeMin) || Number(operation.cycleTimeMin) <= 0 ||
        !isNonNegativeMoney(operation.machiningCost) ||
        !isNonNegativeMoney(operation.setupTimeMin) ||
        !isNonNegativeMoney(operation.setupCost)
      ) return false
      machiningPaise += Math.round(Number(operation.machiningCost) * 100)
      setupPaise += Math.round(Number(operation.setupCost) * 100)
    }

    if (
      machiningPaise !== Math.round(Number(breakdown.machiningCost) * 100) ||
      setupPaise !== Math.round(Number(costing.setupTotal) * 100) ||
      money(Number(costing.setupTotal) / Number(quantity)) !== breakdown.setupCostPerPart ||
      money(Number(costing.recurringTotal) + Number(breakdown.setupCostPerPart)) !== breakdown.unitCost
    ) return false

    normalizedParts.push({ quantity: Number(quantity), unitPrice: Number(unitPrice), lineTotal: Number(lineTotal) })
  }

  if (
    !isNonNegativeMoney(totals.subtotal) ||
    !isNonNegativeMoney(totals.gstPercentage) ||
    Number(totals.gstPercentage) > 100 ||
    !isNonNegativeMoney(totals.gstAmount) ||
    !isNonNegativeMoney(totals.grandTotal)
  ) return false

  const subtotalPaise = normalizedParts.reduce(
    (total, part) => total + Math.round(part.lineTotal * 100), 0,
  )
  const expectedSubtotal = subtotalPaise / 100
  const expectedGst = money(expectedSubtotal * Number(totals.gstPercentage) / 100)
  return (
    totals.subtotal === expectedSubtotal &&
    totals.gstAmount === expectedGst &&
    totals.grandTotal === money(expectedSubtotal + expectedGst)
  )
}

const requiredSnapshotText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export const isApprovedQuotationSnapshot = (
  value: unknown,
): value is ApprovedQuotationSnapshot => {
  if (!value || typeof value !== "object") return false

  const snapshot = value as Record<string, unknown>
  if (snapshot.schemaVersion === 1) {
    // Version 1 is the historical shape. Keep its original read contract so
    // previously approved snapshots are not invalidated by v2 provenance.
    return (
      typeof snapshot.quotationNumber === "string" &&
      typeof snapshot.rfqNumber === "string" &&
      Array.isArray(snapshot.parts) &&
      Boolean(snapshot.totals) &&
      Boolean(snapshot.approval)
    )
  }
  return snapshot.schemaVersion === 2 && isCurrentSnapshotValid(snapshot)
}
