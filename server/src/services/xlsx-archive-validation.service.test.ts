import { describe, expect, it } from "vitest";
import { assertSafeXlsxArchive } from "./xlsx-archive-validation.service.js";

function createZipWithCentralDirectory(
  entries: Array<{ name: string; compressedSize: number; uncompressedSize: number }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(entry.compressedSize, 18);
    local.writeUInt32LE(entry.uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, Buffer.alloc(entry.compressedSize));

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    localOffset += local.length + entry.compressedSize;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralDirectory.length, 12);
  footer.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, footer]);
}

describe("XLSX archive preflight", () => {
  it("accepts a bounded, structurally valid ZIP central directory", () => {
    expect(() =>
      assertSafeXlsxArchive(
        createZipWithCentralDirectory([
          { name: "[Content_Types].xml", compressedSize: 10, uncompressedSize: 100 },
          { name: "xl/workbook.xml", compressedSize: 12, uncompressedSize: 200 },
        ])
      )
    ).not.toThrow();
  });

  it("rejects malformed ZIP data", () => {
    expect(() => assertSafeXlsxArchive(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toThrow(
      "processing safety limits"
    );
  });

  it("rejects archives whose declared expansion exceeds the configured limit", () => {
    expect(() =>
      assertSafeXlsxArchive(
        createZipWithCentralDirectory([
          { name: "xl/worksheets/sheet1.xml", compressedSize: 10, uncompressedSize: 5_000 },
        ]),
        { maxUncompressedBytes: 1_000 }
      )
    ).toThrow("processing safety limits");
  });

  it("rejects archives with too many entries", () => {
    expect(() =>
      assertSafeXlsxArchive(
        createZipWithCentralDirectory([
          { name: "a", compressedSize: 1, uncompressedSize: 1 },
          { name: "b", compressedSize: 1, uncompressedSize: 1 },
        ]),
        { maxEntries: 1 }
      )
    ).toThrow("processing safety limits");
  });
});
