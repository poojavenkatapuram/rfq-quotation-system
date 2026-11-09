import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";

import {
  buildApprovedQuotationSnapshot,
  isApprovedQuotationSnapshot,
  type ApprovedQuotationSnapshot,
} from "./quotation-snapshot.service.js";
import { generateQuotationPdf } from "./quotation-pdf.service.js";

const quotationSource = {
  quotationNumber: "QUO-TEST-123",
  createdAt: new Date("2026-11-05T00:00:00.000Z"),
  validUntil: new Date("2026-12-05T00:00:00.000Z"),
  paymentTerms: "30 days from invoice",
  deliveryTerms: "Delivered to Pune within 4 weeks",
  commercialTerms: "Packaging included",
  notes: "Approved commercial note",
  subtotal: 100000,
  gstPercentage: 18,
  gstAmount: 18000,
  grandTotal: 118000,
  customer: {
    name: "Company B",
    address: "Pune",
    email: "customer@example.com",
    phone: "1234567890",
    gstNumber: "27COMPANYB1234Z5",
  },
  rfq: { rfqNumber: "RFQ-2611-014" },
  parts: [{
    quantity: 1000,
    unitPrice: 100,
    totalPrice: 100000,
    part: {
      partNumber: "PART-001",
      name: "Test spindle",
      description: "Rear wheel spindle",
      materialGrade: "EN8",
      revision: "R2",
      drawingNumber: "DWG-001",
    },
    costing: {
      version: 3,
      totalCost: 74,
      materialRateId: "material-rate-123",
      materialRatePerKgSnapshot: 85,
      grossWeightKg: 0.47,
      scrapPercentage: 5,
      overheadAmount: 5,
      packingAmount: 2,
      freightAmount: 3,
      profitMargin: 20,
      assumptions: "Saved rates at quotation creation",
      components: [
        { type: "MATERIAL", amount: 40 },
        {
          type: "MACHINING", name: "Turning", amount: 20,
          machineRateId: "machine-rate-123", cycleTimeMin: 2,
          ratePerHourSnapshot: 600,
        },
        {
          type: "SETUP", name: "Turning setup", amount: 600,
          machineRateId: "machine-rate-123", setupTimeMinSnapshot: 60,
          ratePerHourSnapshot: 600,
        },
        { type: "SCRAP", amount: 4 },
        { type: "OVERHEAD", amount: 5 },
        { type: "PACKING", amount: 2 },
        { type: "FREIGHT", amount: 3 },
      ],
    },
  }],
};

const makeSnapshot = (): ApprovedQuotationSnapshot =>
  buildApprovedQuotationSnapshot(quotationSource, {
    mode: "SALES_HEAD",
    approvedAt: new Date("2026-11-06T00:00:00.000Z"),
    approverName: "Sales Head",
    approverRole: "SALES_HEAD",
  });

const configuredSnapshot = (): ApprovedQuotationSnapshot => ({
  ...makeSnapshot(),
  company: {
    name: "Test Manufacturer",
    address: "Chakan, Pune",
    email: "sales@example.com",
    phone: "020-12345678",
    gstNumber: "27TEST1234A1Z5",
  },
});

describe("approved quotation snapshots", () => {
  it("preserves saved cost components and commercial terms without reading live rates", () => {
    const snapshot = makeSnapshot();

    expect(snapshot.parts[0]?.costBreakdown).toEqual({
      materialCost: 40,
      machiningCost: 20,
      setupCostPerPart: 0.6,
      scrapCost: 4,
      overheadCost: 5,
      packingCost: 2,
      freightCost: 3,
      unitCost: 74.6,
    });
    expect(snapshot.parts[0]?.profitMarginPercentage).toBe(20);
    expect(snapshot.terms).toEqual({
      paymentTerms: "30 days from invoice",
      deliveryTerms: "Delivered to Pune within 4 weeks",
      commercialTerms: "Packaging included",
      notes: "Approved commercial note",
    });

    quotationSource.parts[0].costing.components[0]!.amount = 999;
    quotationSource.parts[0].part.materialGrade = "Changed after approval";

    expect(snapshot.parts[0]?.costBreakdown.materialCost).toBe(40);
    expect(snapshot.parts[0]?.materialGrade).toBe("EN8");

    quotationSource.parts[0].costing.components[0]!.amount = 40;
    quotationSource.parts[0].part.materialGrade = "EN8";
  });

  it("uses the saved recurring total when legacy rounded components differ by a paisa", () => {
    const snapshot = buildApprovedQuotationSnapshot({
      ...quotationSource,
      parts: quotationSource.parts.map((line) => ({
        ...line,
        costing: {
          ...line.costing,
          components: line.costing.components.map((component) =>
            component.type === "MACHINING"
              ? { ...component, amount: 20.01 }
              : component
          ),
        },
      })),
    }, {
      mode: "SALES_HEAD",
      approvedAt: new Date("2026-11-06T00:00:00.000Z"),
      approverName: "Sales Head",
      approverRole: "SALES_HEAD",
    });

    expect(snapshot.parts[0]?.costBreakdown.machiningCost).toBe(20.01);
    expect(snapshot.parts[0]?.costBreakdown.unitCost).toBe(74.6);
  });

  it("preserves saved rate, operation, setup, drawing, and costing provenance", () => {
    const snapshot = makeSnapshot();
    const provenance = snapshot.parts[0]?.provenance;

    expect(snapshot.schemaVersion).toBe(2);
    expect(provenance).toMatchObject({
      drawingNumber: "DWG-001",
      material: {
        rateId: "material-rate-123",
        ratePerKg: 85,
        currency: "INR",
        grossWeightKg: 0.47,
      },
      costing: {
        version: 3,
        recurringTotal: 74,
        setupTotal: 600,
        scrapPercentage: 5,
        profitMarginPercentage: 20,
        assumptions: "Saved rates at quotation creation",
      },
      operations: [{
        operationName: "Turning",
        machineRateId: "machine-rate-123",
        machineRatePerHour: 600,
        currency: "INR",
        cycleTimeMin: 2,
        machiningCost: 20,
        setupTimeMin: 60,
        setupCost: 600,
      }],
    });
  });

  it("keeps valid version 1 snapshots readable without version 2 provenance", () => {
    const historical: any = structuredClone(makeSnapshot());
    historical.schemaVersion = 1;
    delete historical.parts[0].provenance;

    expect(isApprovedQuotationSnapshot(historical)).toBe(true);
  });

  it.each([
    ["missing customer", (snapshot: any) => { delete snapshot.customer.name; }],
    ["missing quotation number", (snapshot: any) => { snapshot.quotationNumber = ""; }],
    ["missing RFQ reference", (snapshot: any) => { snapshot.rfqNumber = ""; }],
    ["missing part", (snapshot: any) => { snapshot.parts = []; }],
    ["missing part name", (snapshot: any) => { snapshot.parts[0].partName = ""; }],
    ["malformed price", (snapshot: any) => { snapshot.parts[0].unitSellingPrice = "bad"; }],
    ["incorrect line total", (snapshot: any) => { snapshot.parts[0].lineTotal += 0.01; }],
    ["incorrect subtotal", (snapshot: any) => { snapshot.totals.subtotal += 0.01; }],
    ["incorrect GST", (snapshot: any) => { snapshot.totals.gstAmount += 0.01; }],
    ["incorrect grand total", (snapshot: any) => { snapshot.totals.grandTotal += 0.01; }],
    ["unsupported version", (snapshot: any) => { snapshot.schemaVersion = 3; }],
    ["missing provenance", (snapshot: any) => { delete snapshot.parts[0].provenance; }],
  ])("rejects a version 2 snapshot with %s", (_label, mutate) => {
    const snapshot: any = structuredClone(makeSnapshot());
    mutate(snapshot);
    expect(isApprovedQuotationSnapshot(snapshot)).toBe(false);
  });

  it("rejects malformed or missing source financial fields before creating a snapshot", () => {
    const missingTotal: any = structuredClone(quotationSource);
    delete missingTotal.parts[0].costing.totalCost;
    expect(() => buildApprovedQuotationSnapshot(missingTotal, {
      mode: "SALES_HEAD",
      approvedAt: new Date("2026-11-06T00:00:00.000Z"),
    })).toThrow("recurring costing total");

    const malformedPrice: any = structuredClone(quotationSource);
    malformedPrice.parts[0].unitPrice = "not-a-price";
    expect(() => buildApprovedQuotationSnapshot(malformedPrice, {
      mode: "SALES_HEAD",
      approvedAt: new Date("2026-11-06T00:00:00.000Z"),
    })).toThrow("unit selling price");

    const nullGst: any = structuredClone(quotationSource);
    nullGst.gstAmount = null;
    expect(() => buildApprovedQuotationSnapshot(nullGst, {
      mode: "SALES_HEAD",
      approvedAt: new Date("2026-11-06T00:00:00.000Z"),
    })).toThrow("GST amount");
  });

  it("reconciles GST using the saved percentage precision", () => {
    const source = {
      ...quotationSource,
      subtotal: 100000,
      gstPercentage: 18.125,
      gstAmount: 18125,
      grandTotal: 118125,
    };
    const snapshot = buildApprovedQuotationSnapshot(source, {
      mode: "SALES_HEAD",
      approvedAt: new Date("2026-11-06T00:00:00.000Z"),
    });

    expect(snapshot.totals.gstPercentage).toBe(18.125);
    expect(snapshot.totals.gstAmount).toBe(18125);
    expect(isApprovedQuotationSnapshot(snapshot)).toBe(true);
  });
});

describe("generateQuotationPdf", () => {
  it("renders customer-facing commercial data without confidential costing or approval details", async () => {
    const pdf = await generateQuotationPdf(configuredSnapshot());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const parser = new PDFParse({ data: pdf });
    const parsed = await parser.getText();
    await parser.destroy();

    for (const expectedText of [
      "Test Manufacturer",
      "Company B",
      "RFQ-2611-014",
      "QUO-TEST-123",
      "Test spindle",
      "PART-001",
      "EN8",
      "R2",
      "Unit selling price",
      "GST rate",
      "GST amount",
      "Final amount incl. GST",
      "30 days from invoice",
      "Delivered to Pune within 4 weeks",
      "Packaging included",
    ]) {
      expect(parsed.text).toContain(expectedText);
    }

    for (const confidentialText of [
      "Material cost",
      "Machining cost",
      "Setup cost (allocated)",
      "Scrap cost",
      "Overhead",
      "Packing",
      "Freight",
      "Unit cost",
      "Margin assumption",
      "20.00% profit margin",
      "Saved rates at quotation creation",
      "Approved commercial note",
      "Costing scenario",
      "Saved costing version",
      "Approval information",
      "Approval status",
      "Approval route",
      "Approved by",
      "Sales Head",
      "SALES_HEAD",
      "Approved quotation snapshot",
      "material-rate-123",
      "machine-rate-123",
      "DWG-001",
      "Turning",
      "600.00",
      "Saved rates at quotation creation",
    ]) {
      expect(parsed.text).not.toContain(confidentialText);
    }
  });
  it("uses a copied company profile for future snapshots and preserves old PDF content", async () => {
    const company = { name: "Profile Before Update", address: "Registered office, Pune", email: "before@example.com", phone: "+91 9876543210", gstNumber: "27ABCDE1234F1Z5" };
    const oldSnapshot = buildApprovedQuotationSnapshot(quotationSource, { mode: "SALES_HEAD", approvedAt: new Date("2026-11-09"), approverRole: "SALES_HEAD" }, company);
    const originalSnapshot = structuredClone(oldSnapshot);
    company.name = "Profile After Update"; company.email = "after@example.com";
    const futureSnapshot = buildApprovedQuotationSnapshot(quotationSource, { mode: "AUTOMATIC_THRESHOLD", approvedAt: new Date("2026-11-10") }, company);
    expect(oldSnapshot).toEqual(originalSnapshot);
    expect(oldSnapshot.company.name).toBe("Profile Before Update");
    expect(futureSnapshot.company.name).toBe("Profile After Update");
    expect(futureSnapshot.totals).toEqual(oldSnapshot.totals);
    expect(futureSnapshot.parts).toEqual(oldSnapshot.parts);
    for (const [snapshot, expectedName, unexpectedName] of [
      [oldSnapshot, "Profile Before Update", "Profile After Update"],
      [futureSnapshot, "Profile After Update", "Profile Before Update"],
    ] as const) {
      const parser = new PDFParse({ data: await generateQuotationPdf(snapshot) });
      try {
        const parsed = await parser.getText();
        expect(parsed.text).toContain(expectedName); expect(parsed.text).not.toContain(unexpectedName);
        expect(parsed.text).toContain("27ABCDE1234F1Z5");
        expect(parsed.text).not.toContain("Company details pending configuration");
      } finally { await parser.destroy(); }
    }
  });
  it("keeps a historical unconfigured company snapshot unchanged instead of filling it from current configuration", async () => {
    const snapshot = makeSnapshot();
    snapshot.company = { name: null, address: null, email: null, phone: null, gstNumber: null };
    const original = structuredClone(snapshot);
    const parser = new PDFParse({ data: await generateQuotationPdf(snapshot) });
    try { expect((await parser.getText()).text).toContain("Company details pending configuration"); }
    finally { await parser.destroy(); }
    expect(snapshot).toEqual(original);
  });

});

