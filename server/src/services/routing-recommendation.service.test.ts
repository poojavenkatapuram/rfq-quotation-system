import { describe, expect, it } from "vitest";
import {
  rankHistoricalRoutings,
  type HistoricalPart,
} from "./routing-recommendation.service.js";

const candidate = (
  overrides: Partial<HistoricalPart> = {},
): HistoricalPart => ({
  id: "part-1",
  name: "Rear Wheel Spindle",
  partNumber: "RWS-001",
  materialGrade: "EN8",
  grossWeightKg: 0.61,
  rfq: { rfqNumber: "RFQ-HIST-001" },
  routing: {
    revision: 1,
    operations: [
      {
        sequence: 1,
        operationName: "CNC Turning",
        cycleTimeMin: 3.2,
        setupTimeMin: 60,
        machineRateId: "machine-rate-1",
        machineRate: {
          id: "machine-rate-1",
          machineCode: "CNC-01",
          machineName: "CNC Turning",
          ratePerHour: 850,
        },
      },
    ],
  },
  ...overrides,
});

describe("Historical routing recommendations", () => {
  const target = {
    name: "Rear Wheel Spindle",
    materialGrade: "EN8",
    grossWeightKg: 0.61,
  };

  it("ranks an exact historical match highest", () => {
    const results = rankHistoricalRoutings(target, [
      candidate({ id: "less-similar", materialGrade: "EN9" }),
      candidate(),
    ]);

    expect(results[0].sourcePartId).toBe("part-1");
    expect(results[0].similarityScore).toBe(100);
  });

  it("returns historical source and actual operation details", () => {
    const results = rankHistoricalRoutings(target, [candidate()]);

    expect(results[0].sourceRfqNumber).toBe("RFQ-HIST-001");
    expect(results[0].operations[0]).toMatchObject({
      operationName: "CNC Turning",
      cycleTimeMin: 3.2,
      setupTimeMin: 60,
      machineRate: {
        machineCode: "CNC-01",
        ratePerHour: 850,
      },
    });
  });

  it("ranks matching material and similar weight", () => {
    const results = rankHistoricalRoutings(target, [
      candidate({
        id: "different-material",
        materialGrade: "EN9",
        grossWeightKg: 0.61,
      }),
      candidate({
        id: "matching-material",
        materialGrade: "EN8",
        grossWeightKg: 0.65,
      }),
    ]);

    expect(results[0].sourcePartId).toBe("matching-material");
  });

  it("excludes historical parts without routing operations", () => {
    const results = rankHistoricalRoutings(target, [
      candidate({ routing: null }),
      candidate({
        id: "empty-routing",
        routing: { revision: 1, operations: [] },
      }),
      candidate(),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].sourcePartId).toBe("part-1");
  });

  it("returns no recommendations when no historical routing exists", () => {
    expect(rankHistoricalRoutings(target, [])).toEqual([]);
  });

  it("returns at most five ranked recommendations", () => {
    const candidates = Array.from({ length: 8 }, (_, index) =>
      candidate({ id: `part-${index}` }),
    );

    expect(rankHistoricalRoutings(target, candidates)).toHaveLength(5);
  });
  it("does not recommend unrelated parts based on weight alone", () => {
    expect(rankHistoricalRoutings(target, [candidate({ name: "Unrelated bracket", materialGrade: "AL6061" })])).toEqual([]);
  });
  it("uses a stable source ID ordering for equally scored matches", () => {
    expect(rankHistoricalRoutings(target, [candidate({ id: "z" }), candidate({ id: "a" })]).map(item => item.sourcePartId)).toEqual(["a", "z"]);
  });
  it("does not invent an operation when historical timing data is invalid", () => {
    const invalid = candidate(); invalid.routing!.operations[0].cycleTimeMin = "invalid";
    expect(rankHistoricalRoutings(target, [invalid])).toEqual([]);
  });
  it("exposes source revision and treats missing weight as missing evidence", () => {
    const result = rankHistoricalRoutings({ ...target, grossWeightKg: null }, [candidate({ grossWeightKg: null })])[0];
    expect(result.sourceRoutingRevision).toBe(1);
    expect(result.sourceWeightKg).toBeNull();
    expect(result.matchingFactors.weightSimilarity).toBe(0);
    expect(result.similarityScore).toBe(80);
  });

});
