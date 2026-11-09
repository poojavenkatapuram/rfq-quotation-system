export type HistoricalPart = {
  id: string
  name: string
  partNumber: string | null
  materialGrade: string | null
  grossWeightKg: unknown
  rfq: { rfqNumber: string }
  routing: {
    revision: number
    operations: Array<{
      sequence: number
      operationName: string
      cycleTimeMin: unknown
      setupTimeMin: unknown
      machineRateId: string | null
      machineRate: {
        id: string
        machineCode: string
        machineName: string
        ratePerHour: unknown
      } | null
    }>
  } | null
}

export type TargetPart = {
  name: string
  materialGrade: string | null
  grossWeightKg: unknown
}

const tokens = (value: string) =>
  new Set(value.toLowerCase().match(/[a-z0-9]+/g) || [])

const nameSimilarity = (a: string, b: string) => {
  const left = tokens(a)
  const right = tokens(b)
  if (!left.size || !right.size) return 0

  const intersection = [...left].filter((word) => right.has(word)).length
  return intersection / new Set([...left, ...right]).size
}

export function rankHistoricalRoutings(
  target: TargetPart,
  candidates: HistoricalPart[],
) {
  const targetWeight = Number(target.grossWeightKg)

  return candidates
    .filter((candidate) =>
      candidate.routing && candidate.routing.operations.length > 0 &&
      candidate.routing.operations.every(operation =>
        Number.isFinite(Number(operation.cycleTimeMin)) && Number(operation.cycleTimeMin) > 0 &&
        (operation.setupTimeMin === null || (Number.isFinite(Number(operation.setupTimeMin)) && Number(operation.setupTimeMin) >= 0))
      )
    )
    .map((candidate) => {
      const materialMatch = Boolean(
        target.materialGrade &&
        candidate.materialGrade &&
        target.materialGrade.trim().toLowerCase() ===
          candidate.materialGrade.trim().toLowerCase()
      )

      const nameScore = nameSimilarity(target.name, candidate.name)
      const candidateWeight = Number(candidate.grossWeightKg)

      let weightScore = 0
      if (
        Number.isFinite(targetWeight) &&
        targetWeight > 0 &&
        Number.isFinite(candidateWeight) &&
        candidateWeight > 0
      ) {
        const difference = Math.abs(targetWeight - candidateWeight) / targetWeight
        weightScore = Math.max(0, 1 - difference)
      }

      const score =
        (materialMatch ? 45 : 0) +
        nameScore * 35 +
        weightScore * 20

      return {
        sourcePartId: candidate.id,
        sourceRoutingRevision: candidate.routing!.revision,
        sourcePartNumber: candidate.partNumber,
        sourcePartName: candidate.name,
        sourceMaterialGrade: candidate.materialGrade,
        sourceWeightKg: Number.isFinite(candidateWeight) && candidateWeight > 0 ? candidateWeight : null,
        sourceRfqNumber: candidate.rfq.rfqNumber,
        similarityScore: Math.round(score),
        matchingFactors: {
          materialGradeMatch: materialMatch,
          partNameSimilarity: Math.round(nameScore * 100),
          weightSimilarity: Math.round(weightScore * 100),
        },
        operations: candidate.routing!.operations.map((operation) => ({
          sequence: operation.sequence,
          operationName: operation.operationName,
          cycleTimeMin: Number(operation.cycleTimeMin),
          setupTimeMin:
            operation.setupTimeMin === null
              ? null
              : Number(operation.setupTimeMin),
          machineRateId: operation.machineRate?.id ?? null,
          machineRate: operation.machineRate
            ? {
                machineCode: operation.machineRate.machineCode,
                machineName: operation.machineRate.machineName,
                ratePerHour: Number(operation.machineRate.ratePerHour),
              }
            : null,
        })),
      }
    })
    .filter(result => result.similarityScore >= 35 && (result.matchingFactors.materialGradeMatch || result.matchingFactors.partNameSimilarity >= 50))
    .sort((a, b) => b.similarityScore - a.similarityScore || a.sourcePartId.localeCompare(b.sourcePartId))
    .slice(0, 5)
}
