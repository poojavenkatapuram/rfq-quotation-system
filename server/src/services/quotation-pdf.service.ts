import PDFDocument from "pdfkit";

type QuotationPdfData = {
  quotationNumber: string;
  status: string;
  createdAt: Date;
  validUntil: Date | null;
  gstPercentage: unknown;
  subtotal: unknown;
  gstAmount: unknown;
  grandTotal: unknown;
  notes: string | null;
  customer: {
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    gstNumber: string | null;
  };
  rfq: {
    rfqNumber: string;
  };
  parts: Array<{
    quantity: number;
    unitPrice: unknown;
    totalPrice: unknown;
    part: {
      partNumber: string | null;
      name: string;
      description: string | null;
      materialGrade: string | null;
    };
  }>;
};

const amount = (value: unknown) =>
  `INR ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const date = (value: Date | null) =>
  value ? new Date(value).toLocaleDateString("en-IN") : "Not specified";

export const generateQuotationPdf = (
  quotation: QuotationPdfData
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      bufferPages: true,
      info: {
        Title: `Quotation ${quotation.quotationNumber}`,
        Author: "Company A",
        Subject: "Customer quotation",
      },
    });

    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const left = 48;
    const right = 547;
    const contentWidth = right - left;

    doc.font("Helvetica-Bold").fontSize(20).text("COMPANY A", left, 48);
    doc.font("Helvetica").fontSize(9).fillColor("#555555")
      .text("AUTO-COMPONENT MANUFACTURER", left, 74);

    doc.fillColor("#111111").font("Helvetica-Bold").fontSize(19)
      .text("QUOTATION", 350, 48, { width: 197, align: "right" });

    doc.font("Helvetica").fontSize(9).fillColor("#444444")
      .text(quotation.quotationNumber, 350, 76, {
        width: 197,
        align: "right",
      })
      .text(`Date: ${date(quotation.createdAt)}`, 350, 90, {
        width: 197,
        align: "right",
      });

    doc.moveTo(left, 112).lineTo(right, 112).lineWidth(1)
      .strokeColor("#333333").stroke();

    let y = 130;

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111")
      .text("CUSTOMER", left, y);

    doc.font("Helvetica").fontSize(9).fillColor("#333333")
      .text(quotation.customer.name, left, y + 17, { width: 230 });

    let customerY = y + 32;

    for (const detail of [
      quotation.customer.address,
      quotation.customer.email,
      quotation.customer.phone,
      quotation.customer.gstNumber
        ? `GSTIN: ${quotation.customer.gstNumber}`
        : null,
    ]) {
      if (detail) {
        doc.text(detail, left, customerY, { width: 230 });
        customerY += 13;
      }
    }

    doc.font("Helvetica-Bold").fontSize(10).fillColor("#111111")
      .text("QUOTATION DETAILS", 320, y);

    doc.font("Helvetica").fontSize(9).fillColor("#333333")
      .text(`RFQ: ${quotation.rfq.rfqNumber}`, 320, y + 17)
      .text(`Valid until: ${date(quotation.validUntil)}`, 320, y + 32)
      .text(`Status: ${quotation.status}`, 320, y + 47);

    y = Math.max(customerY, y + 75) + 18;

    doc.moveTo(left, y).lineTo(right, y)
      .strokeColor("#cccccc").stroke();

    y += 16;

    const columns = [
      { label: "Part / Description", x: left, width: 190 },
      { label: "Material", x: 240, width: 75 },
      { label: "Quantity", x: 315, width: 65 },
      { label: "Unit price", x: 380, width: 82 },
      { label: "Total", x: 462, width: 85 },
    ];

    const drawTableHeader = () => {
      doc.rect(left, y, contentWidth, 25).fill("#eeeeee");
      doc.fillColor("#111111").font("Helvetica-Bold").fontSize(8);

      columns.forEach((column) => {
        doc.text(column.label, column.x + 4, y + 8, {
          width: column.width - 8,
          align: column.label === "Part / Description" ? "left" : "right",
        });
      });

      y += 32;
    };

    drawTableHeader();

    for (const [index, line] of quotation.parts.entries()) {
      const partName = line.part.partNumber || line.part.name;
      const description =
        line.part.description && line.part.description !== partName
          ? line.part.description
          : "";
      const partLabel = description
        ? `${partName}\n${description}`
        : partName;

      const rowHeight = Math.max(
        34,
        doc.fontSize(8).heightOfString(partLabel, { width: 182 }) + 12
      );

      if (y + rowHeight > 735) {
        doc.addPage();
        y = 48;
        drawTableHeader();
      }

      doc.font("Helvetica").fontSize(8).fillColor("#333333");
      doc.text(partLabel, left + 4, y, { width: 182 });
      doc.text(line.part.materialGrade || "—", 244, y, {
        width: 67,
        align: "right",
      });
      doc.text(line.quantity.toLocaleString("en-IN"), 319, y, {
        width: 57,
        align: "right",
      });
      doc.text(amount(line.unitPrice), 384, y, {
        width: 74,
        align: "right",
      });
      doc.text(amount(line.totalPrice), 466, y, {
        width: 77,
        align: "right",
      });

      y += rowHeight;
      doc.moveTo(left, y).lineTo(right, y)
        .strokeColor("#dddddd").stroke();
      y += 9;
    }

    if (y > 625) {
      doc.addPage();
      y = 60;
    }

    y += 12;

    const totalsX = 330;
    const totalsWidth = 217;

    doc.font("Helvetica").fontSize(10).fillColor("#333333")
      .text("Subtotal", totalsX, y, { width: 100 })
      .text(amount(quotation.subtotal), totalsX + 100, y, {
        width: 117,
        align: "right",
      });

    y += 21;

    doc.text(`GST (${Number(quotation.gstPercentage)}%)`, totalsX, y, {
      width: 100,
    }).text(amount(quotation.gstAmount), totalsX + 100, y, {
      width: 117,
      align: "right",
    });

    y += 24;

    doc.moveTo(totalsX, y).lineTo(right, y)
      .strokeColor("#333333").lineWidth(1).stroke();

    y += 12;

    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111111")
      .text("GRAND TOTAL", totalsX, y, { width: 100 })
      .text(amount(quotation.grandTotal), totalsX + 100, y, {
        width: 117,
        align: "right",
      });

    y += 42;

    if (quotation.notes) {
      if (y > 700) {
        doc.addPage();
        y = 55;
      }

      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111")
        .text("NOTES", left, y);

      y += 15;

      doc.font("Helvetica").fontSize(9).fillColor("#444444")
        .text(quotation.notes, left, y, { width: contentWidth });
    }

    doc.end();
  });
