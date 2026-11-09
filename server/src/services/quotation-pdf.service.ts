import PDFDocument from "pdfkit";
import type { ApprovedQuotationSnapshot } from "./quotation-snapshot.service.js";

const amount = (value: number) =>
  "INR " + value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const date = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "Not specified";

const line = (
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) => {
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333")
    .text(label, x, y, { width: 95 });
  doc.font("Helvetica").fontSize(8).fillColor("#333333")
    .text(value, x + 98, y, { width: width - 98 });
};

export const generateQuotationPdf = (
  quotation: ApprovedQuotationSnapshot,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: "Quotation " + quotation.quotationNumber,
        Subject: "Approved customer quotation",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const left = 48;
    const right = 547;
    const width = right - left;
    let y = 48;

    const pageHeader = () => {
      const companyName = quotation.company.name ||
        "COMPANY DETAILS PENDING CONFIGURATION";

      doc.font("Helvetica-Bold").fontSize(17).fillColor("#111111")
        .text(companyName, left, 48, { width: 285 });
      doc.font("Helvetica").fontSize(8).fillColor("#555555")
        .text("CUSTOMER QUOTATION", left, 71);

      doc.font("Helvetica-Bold").fontSize(17).fillColor("#111111")
        .text("QUOTATION", 340, 48, { width: 207, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor("#444444")
        .text(quotation.quotationNumber, 340, 71, {
          width: 207,
          align: "right",
        })
        .text("Quotation date: " + date(quotation.quotationDate), 340, 83, {
          width: 207,
          align: "right",
        });

      doc.moveTo(left, 102).lineTo(right, 102)
        .strokeColor("#333333").lineWidth(1).stroke();
      y = 120;
    };

    const ensureSpace = (needed: number) => {
      if (y + needed <= 745) return;
      doc.addPage();
      pageHeader();
    };

    const section = (title: string, requiredContentHeight = 0) => {
      ensureSpace(28 + requiredContentHeight);
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111")
        .text(title, left, y);
      y += 15;
      doc.moveTo(left, y).lineTo(right, y)
        .strokeColor("#cccccc").lineWidth(0.75).stroke();
      y += 9;
    };

    const details = (
      entries: Array<[string, string]>,
      columnX = left,
      columnWidth = width,
    ) => {
      for (const [label, value] of entries) {
        doc.font("Helvetica-Bold").fontSize(8);
        const labelHeight = doc.heightOfString(label, { width: 95 });
        doc.font("Helvetica").fontSize(8);
        const valueHeight = doc.heightOfString(value, {
          width: columnWidth - 98,
        });
        const rowHeight = Math.max(
          13,
          Math.ceil(Math.max(labelHeight, valueHeight) + 3),
        );
        ensureSpace(rowHeight);
        line(doc, label, value, columnX, y, columnWidth);
        y += rowHeight;
      }
    };

    pageHeader();

    section("COMPANY AND CUSTOMER");
    const companyDetails = [
      quotation.company.address,
      quotation.company.email,
      quotation.company.phone,
      quotation.company.gstNumber
        ? "GSTIN: " + quotation.company.gstNumber
        : null,
    ].filter((item): item is string => Boolean(item));

    const customerDetails = [
      quotation.customer.address,
      quotation.customer.email,
      quotation.customer.phone,
      quotation.customer.gstNumber
        ? "GSTIN: " + quotation.customer.gstNumber
        : null,
    ].filter((item): item is string => Boolean(item));

    line(
      doc,
      "Company",
      quotation.company.name || "Company details pending configuration",
      left,
      y,
      width,
    );
    y += 13;
    for (const value of companyDetails) {
      ensureSpace(14);
      doc.font("Helvetica").fontSize(8).fillColor("#333333")
        .text(value, left + 98, y, { width: width - 98 });
      y += 13;
    }
    line(doc, "Customer", quotation.customer.name, left, y, width);
    y += 13;
    for (const value of customerDetails) {
      ensureSpace(14);
      doc.font("Helvetica").fontSize(8).fillColor("#333333")
        .text(value, left + 98, y, { width: width - 98 });
      y += 13;
    }

    section("QUOTATION DETAILS");
    details([
      ["RFQ number", quotation.rfqNumber],
      ["Quotation number", quotation.quotationNumber],
      ["Quotation date", date(quotation.quotationDate)],
      ["Validity", date(quotation.validUntil)],
    ]);

    for (const [index, part] of quotation.parts.entries()) {
      ensureSpace(235);
      section(
        "PART " + (index + 1) + ": " + (part.partNumber || part.partName),
      );
      details([
        ["Part name", part.partName],
        ["Part number", part.partNumber || "Not specified"],
        ["Material", part.materialGrade || "Not specified"],
        ["Revision", part.revision || "Not specified"],
        ["Annual volume", part.annualVolume.toLocaleString("en-IN")],
      ]);

      ensureSpace(70);
      doc.rect(left, y, width, 20).fill("#eeeeee");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111")
        .text("COMMERCIAL PRICING", left + 5, y + 6, {
          width: width - 150,
        })
        .text("AMOUNT", right - 115, y + 6, {
          width: 110,
          align: "right",
        });
      y += 25;

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111")
        .text("Unit selling price", left + 5, y, { width: width - 150 })
        .text(amount(part.unitSellingPrice), right - 115, y, {
          width: 110,
          align: "right",
        });
      y += 14;
      doc.text("Annual line value", left + 5, y, { width: width - 150 })
        .text(amount(part.lineTotal), right - 115, y, {
          width: 110,
          align: "right",
        });
      y += 19;
    }

    section("QUOTATION TOTALS");
    details([
      ["Subtotal", amount(quotation.totals.subtotal)],
      ["GST rate", quotation.totals.gstPercentage.toFixed(2) + "%"],
      ["GST amount", amount(quotation.totals.gstAmount)],
      ["Final amount incl. GST", amount(quotation.totals.grandTotal)],
    ]);

    section("COMMERCIAL CONDITIONS", 75);
    details([
      ["Payment terms", quotation.terms.paymentTerms || "Not specified"],
      ["Delivery terms", quotation.terms.deliveryTerms || "Not specified"],
      [
        "Other commercial conditions",
        quotation.terms.commercialTerms || "Not specified",
      ],
    ]);

    const range = doc.bufferedPageRange();
    for (let page = 0; page < range.count; page += 1) {
      doc.switchToPage(page);
      doc.font("Helvetica").fontSize(7).fillColor("#666666")
        .text(
          "Quotation " + quotation.quotationNumber +
            " | Page " + (page + 1) + " of " + range.count,
          left,
          785,
          { width, align: "center" },
        );
    }

    doc.end();
  });
