const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

export const MAX_XLSX_ARCHIVE_ENTRIES = 1_000;
export const MAX_XLSX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

export interface XlsxArchiveValidationOptions {
  maxEntries?: number;
  maxUncompressedBytes?: number;
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  const minimumOffset = Math.max(
    0,
    buffer.length - END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE - MAX_ZIP_COMMENT_BYTES
  );

  for (
    let offset = buffer.length - END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return undefined;
}

/**
 * Rejects malformed ZIP data and archives that would make an XLSX parser
 * expand more than the bounded amount of untrusted data. This is a preflight,
 * not a substitute for the parser's own structural validation.
 */
export function assertSafeXlsxArchive(
  buffer: Buffer,
  options: XlsxArchiveValidationOptions = {}
): void {
  const maxEntries = options.maxEntries ?? MAX_XLSX_ARCHIVE_ENTRIES;
  const maxUncompressedBytes =
    options.maxUncompressedBytes ?? MAX_XLSX_UNCOMPRESSED_BYTES;
  const fail = (): never => {
    throw new Error("The Excel workbook is invalid or exceeds processing safety limits");
  };

  if (buffer.length < END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE) fail();

  const foundEndOffset = findEndOfCentralDirectory(buffer);
  if (foundEndOffset === undefined) {
    throw new Error("The Excel workbook is invalid or exceeds processing safety limits");
  }
  const endOffset = foundEndOffset;

  if (endOffset + END_OF_CENTRAL_DIRECTORY_MINIMUM_SIZE > buffer.length) {
    fail();
  }

  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);

  // ZIP64 needs a separate parser and is not necessary for the small RFQ
  // documents this endpoint accepts. Reject it instead of guessing.
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    entryCount === 0 ||
    entryCount > maxEntries ||
    centralDirectoryOffset + centralDirectorySize > endOffset
  ) {
    fail();
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
      fail();
    }

    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const fileCommentLength = buffer.readUInt16LE(cursor + 32);
    const entrySize = 46 + fileNameLength + extraFieldLength + fileCommentLength;

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      entrySize > centralDirectorySize ||
      cursor + entrySize > endOffset
    ) {
      fail();
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maxUncompressedBytes) fail();

    cursor += entrySize;
  }

  if (cursor !== centralDirectoryOffset + centralDirectorySize) fail();
}
