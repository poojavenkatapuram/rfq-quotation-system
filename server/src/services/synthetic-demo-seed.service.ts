import type { PrismaClient } from "@prisma/client";
import { SYNTHETIC_DATABASE_NAME } from "./synthetic-demo-safety.service.js";
import { SYNTHETIC_PART_FAMILIES } from "../fixtures/synthetic-history.fixtures.js";

export async function seedSyntheticManufacturing(prisma: PrismaClient, actorId: string) {
  return prisma.$transaction(async tx => {
    const [identity] = await tx.$queryRaw<Array<{ name: string; schema: string }>>`SELECT current_database() AS name, current_schema() AS schema`;
    if (identity?.name !== SYNTHETIC_DATABASE_NAME || identity.schema !== "public") throw new Error("Refusing demo seed outside the isolated synthetic database");
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
    if (!actor || !["ADMIN", "ESTIMATOR"].includes(actor.role)) throw new Error("An existing Admin or Estimator actor is required");
    const effectiveFrom = new Date("2025-01-01T00:00:00Z");
    const customers = [];
    for (let n = 1; n <= 2; n++) {
      const id = `SYNDEMO-V1-CUSTOMER-${n}`;
      customers.push(await tx.customer.upsert({ where: { id }, update: {}, create: {
        id, code: `SYNDEMO-V1-C${n}`, name: `SYNTHETIC DEMO Customer ${String(n).padStart(2, "0")}`,
        address: "SYNTHETIC DEMO — illustrative Pune industrial area, Maharashtra, India", email: `synthetic-demo-${n}@example.invalid`,
      } }));
    }
    const materials: Array<{ id: string; grade: string }> = [];
    for (const [grade, rate] of [["EN8", 74], ["20MnCr5", 96], ["C45", 78]] as const) {
      const id = `SYNDEMO-V1-MAT-${grade}`;
      materials.push(await tx.materialRate.upsert({ where: { id }, update: {}, create: {
        id, materialCode: id, materialName: `SYNTHETIC DEMO ${grade} steel`, grade, ratePerKg: rate, currency: "INR", effectiveFrom,
      } }));
    }
    const machines: Array<{ id: string }> = [];
    for (const [code, name, rate] of [["CNC", "CNC turning centre", 850], ["VMC", "Vertical machining centre", 1200], ["FORGE", "Forging press", 1600]] as const) {
      const id = `SYNDEMO-V1-MACHINE-${code}`;
      machines.push(await tx.machineRate.upsert({ where: { id }, update: {}, create: {
        id, machineCode: id, machineName: `SYNTHETIC DEMO ${name}`, ratePerHour: rate, currency: "INR", effectiveFrom,
      } }));
    }
    let createdRFQs = 0;
    for (let group = 0; group < 2; group++) {
      const id = `SYNDEMO-V1-MFG-RFQ-${group + 1}`;
      const existing = await tx.rFQ.findUnique({ where: { id }, select: { id: true } });
      if (existing) continue; // Preserve manual changes; never overwrite seeded records.
      await tx.rFQ.create({ data: {
        id, rfqNumber: id, customerId: customers[group]!.id, createdById: actorId,
        receivedDate: new Date("2025-02-01T00:00:00Z"), dueDate: new Date("2025-02-28T00:00:00Z"),
        notes: "SYNTHETIC DEMO DATA — optional manufacturing examples, not client transactions; unapproved draft routings.",
        parts: { create: SYNTHETIC_PART_FAMILIES.slice(group * 3, group * 3 + 3).map((family, index) => ({
          id: `SYNDEMO-V1-MFG-PART-${family.code}`, partNumber: `SYNDEMO-V1-MFG-${family.code}`, name: `SYNTHETIC DEMO ${family.name}`,
          description: "Synthetic illustrative machining/forging example; no client drawing or approved costing.",
          materialGrade: family.material, materialRateId: materials.find(material => material.grade === family.material)!.id,
          grossWeightKg: family.grossWeightKg, annualVolume: [12000, 24000, 60000][index],
          routing: { create: { id: `SYNDEMO-V1-ROUTING-${family.code}`, name: "SYNTHETIC DEMO — draft technical review required", operations: { create: [
            { sequence: 1, operationName: family.code === "BRACKET" ? "SYNTHETIC DEMO — forging" : "SYNTHETIC DEMO — CNC turning", machineRateId: machines[family.code === "BRACKET" ? 2 : 0]!.id, cycleTimeMin: 2.5 + index, setupTimeMin: 30 },
            { sequence: 2, operationName: "SYNTHETIC DEMO — milling and drilling", machineRateId: machines[1]!.id, cycleTimeMin: 1.5 + index * 0.5, setupTimeMin: 25 },
          ] } } },
        })) },
      } });
      createdRFQs++;
      await tx.auditLog.create({ data: { actorId, action: "SYNTHETIC_DEMO_SEEDED", entityType: "RFQ", entityId: id, details: { label: "SYNTHETIC DEMO DATA", dataset: "SYNDEMO-V1" } } });
    }
    return { label: "SYNTHETIC DEMO DATA", customers: 2, materials: 3, machines: 3, createdRFQs, expectedParts: 6, expectedDraftRoutings: 6 };
  }, { timeout: 30000 });
}
