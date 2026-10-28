import { toQR } from 'toqr';
import type { EventModel } from '../services/eventService';

/**
 * Extracts the real event ID from an EventModel or string identifier.
 * Prevents using invalid inputs such as user IDs (createdBy), event titles, or list indices.
 */
export function extractEventId(eventOrId: EventModel | string | null | undefined): string | null {
  if (!eventOrId) {
    return null;
  }

  if (typeof eventOrId === 'string') {
    const trimmed = eventOrId.trim();
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
      return null;
    }
    return trimmed;
  }

  if (typeof eventOrId === 'object') {
    // Check canonical `id` field
    if (typeof eventOrId.id === 'string' && eventOrId.id.trim().length > 0) {
      const trimmed = eventOrId.id.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }

    // Check MongoDB `_id.$oid` structure
    if (
      eventOrId._id &&
      typeof eventOrId._id === 'object' &&
      typeof eventOrId._id.$oid === 'string' &&
      eventOrId._id.$oid.trim().length > 0
    ) {
      const trimmed = eventOrId._id.$oid.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }

    // Fallback if _id is a plain string
    if (typeof (eventOrId as any)._id === 'string' && (eventOrId as any)._id.trim().length > 0) {
      const trimmed = (eventOrId as any)._id.trim();
      if (trimmed !== 'undefined' && trimmed !== 'null') {
        return trimmed;
      }
    }
  }

  return null;
}

/**
 * Normalizes and validates the redirect base URL.
 * Prevents accidental duplicate or missing slashes.
 * Ensures the base URL starts with http:// or https://.
 */
export function normalizeRedirectUrl(rawUrl?: string | null): string {
  const urlToClean =
    rawUrl !== undefined && rawUrl !== null ? rawUrl : process.env.EXPO_PUBLIC_REDIRECT_URL;

  if (urlToClean === undefined || urlToClean === null) {
    throw new Error(
      'Missing redirect URL: EXPO_PUBLIC_REDIRECT_URL environment variable is not configured.',
    );
  }

  if (typeof urlToClean !== 'string') {
    throw new Error('Redirect URL must be a string.');
  }

  const trimmed = urlToClean.trim();
  if (!trimmed) {
    throw new Error('Redirect URL cannot be empty.');
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(
      `Invalid redirect URL "${trimmed}". The URL must start with http:// or https://.`,
    );
  }

  // Strip all trailing slashes to prevent duplicate slashes
  return trimmed.replace(/\/+$/, '');
}

/**
 * Generates the QR destination URL dynamically from an event's real ID.
 *
 * URL Format: {EXPO_PUBLIC_REDIRECT_URL}/event/{eventId}/live
 *
 * Example: https://staging.entephoto.co.in/event/6ae232dda3d8336883d8b69b/live
 *
 * @param eventOrId - The EventModel object or event ID string
 * @param customRedirectUrl - Optional override for the redirect base URL
 * @returns The fully qualified normalized QR destination URL
 * @throws Error if redirect URL or event ID is missing or invalid
 */
export function generateEventLiveQrUrl(
  eventOrId: EventModel | string | null | undefined,
  customRedirectUrl?: string | null,
): string {
  const normalizedBase = normalizeRedirectUrl(customRedirectUrl);

  const eventId = extractEventId(eventOrId);
  if (!eventId) {
    throw new Error(
      'Missing or invalid event ID: Cannot generate QR URL without a valid event ID.',
    );
  }

  // Strip leading and trailing slashes from the event ID to prevent duplicate slashes
  const sanitizedEventId = encodeURIComponent(eventId.replace(/^\/+|\/+$/g, ''));
  if (!sanitizedEventId) {
    throw new Error('Event ID is empty after sanitization.');
  }

  return `${normalizedBase}/event/${sanitizedEventId}/live`;
}

export interface GenerateQrUrlResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Safe version of generateEventLiveQrUrl that returns a result object
 * instead of throwing an error.
 */
export function tryGenerateEventLiveQrUrl(
  eventOrId: EventModel | string | null | undefined,
  customRedirectUrl?: string | null,
): GenerateQrUrlResult {
  try {
    const url = generateEventLiveQrUrl(eventOrId, customRedirectUrl);
    return { success: true, url };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to generate QR URL' };
  }
}

/**
 * Fast CRC-32 calculation for PNG chunk checksums.
 */
function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

const crcTable = createCrcTable();

export function crc32(buf: Uint8Array, offset = 0, length = buf.length - offset): number {
  let c = 0xffffffff;
  const end = offset + length;
  for (let i = offset; i < end; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adler-32 checksum required by the zlib container specification (RFC 1950).
 */
export function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Generates an uncompressed high-resolution PNG image directly from a QR URL.
 * Produces crisp, pixel-perfect black & white modules with standard quiet-zone margins.
 *
 * @param url - Destination live event URL to encode
 * @param scale - Pixels per QR module (default 20 -> ~820x820px)
 * @param quietZone - Quiet-zone margin in modules (default 4)
 * @returns Uint8Array containing complete PNG file bytes
 */
export function generateQrPngBytes(url: string, scale = 20, quietZone = 4): Uint8Array {
  const matrix = toQR(url);
  const modSize = Math.round(Math.sqrt(matrix.length));
  if (modSize === 0) {
    throw new Error('Failed to generate QR matrix: empty output.');
  }

  const totalMods = modSize + quietZone * 2;
  const imgSize = totalMods * scale;

  // Raw uncompressed scanlines (Grayscale 8-bit: 1 byte/pixel: 0=black, 255=white)
  // Each scanline begins with a filter-type byte (0 = None)
  const rowBytes = 1 + imgSize;
  const rawData = new Uint8Array(rowBytes * imgSize);

  // Initialize all pixels to white (255)
  rawData.fill(255);
  // Ensure filter byte is 0 for every scanline
  for (let y = 0; y < imgSize; y++) {
    rawData[y * rowBytes] = 0;
  }

  // Paint dark modules (0)
  for (let my = 0; my < modSize; my++) {
    for (let mx = 0; mx < modSize; mx++) {
      if (matrix[my * modSize + mx]) {
        const startY = (my + quietZone) * scale;
        const startX = (mx + quietZone) * scale;
        for (let dy = 0; dy < scale; dy++) {
          const rowOffset = (startY + dy) * rowBytes + 1 + startX;
          rawData.fill(0, rowOffset, rowOffset + scale);
        }
      }
    }
  }

  // Wrap in uncompressed DEFLATE blocks (up to 65,535 bytes per block)
  const MAX_BLOCK = 65535;
  const numBlocks = Math.ceil(rawData.length / MAX_BLOCK) || 1;
  const idatPayloadLen = 2 + numBlocks * 5 + rawData.length + 4;
  const idatPayload = new Uint8Array(idatPayloadLen);
  let pos = 0;

  // ZLIB header: CMF = 0x78 (deflate, 32k window), FLG = 0x01 (check bits)
  idatPayload[pos++] = 0x78;
  idatPayload[pos++] = 0x01;

  for (let i = 0; i < numBlocks; i++) {
    const isLast = i === numBlocks - 1;
    const start = i * MAX_BLOCK;
    const end = Math.min(start + MAX_BLOCK, rawData.length);
    const chunkLen = end - start;
    const chunkNlen = ~chunkLen & 0xffff;

    idatPayload[pos++] = isLast ? 0x01 : 0x00; // BFINAL, BTYPE=00 (uncompressed)
    idatPayload[pos++] = chunkLen & 0xff;
    idatPayload[pos++] = (chunkLen >> 8) & 0xff;
    idatPayload[pos++] = chunkNlen & 0xff;
    idatPayload[pos++] = (chunkNlen >> 8) & 0xff;

    idatPayload.set(rawData.subarray(start, end), pos);
    pos += chunkLen;
  }

  // Adler-32 checksum (Big-Endian)
  const adler = adler32(rawData);
  idatPayload[pos++] = (adler >> 24) & 0xff;
  idatPayload[pos++] = (adler >> 16) & 0xff;
  idatPayload[pos++] = (adler >> 8) & 0xff;
  idatPayload[pos++] = adler & 0xff;

  // Assemble full PNG file:
  // Signature (8 bytes) + IHDR (25 bytes) + IDAT (12 + payload) + IEND (12 bytes)
  const totalPngLen = 8 + 25 + (12 + idatPayload.length) + 12;
  const png = new Uint8Array(totalPngLen);
  let outPos = 0;

  // 1. PNG Signature: 137 80 78 71 13 10 26 10
  png.set([137, 80, 78, 71, 13, 10, 26, 10], outPos);
  outPos += 8;

  // 2. IHDR Chunk (Length 13)
  const ihdrLen = 13;
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = ihdrLen;
  const ihdrTypePos = outPos;
  png.set([73, 72, 68, 82], outPos); // 'IHDR'
  outPos += 4;
  // Width
  png[outPos++] = (imgSize >> 24) & 0xff;
  png[outPos++] = (imgSize >> 16) & 0xff;
  png[outPos++] = (imgSize >> 8) & 0xff;
  png[outPos++] = imgSize & 0xff;
  // Height
  png[outPos++] = (imgSize >> 24) & 0xff;
  png[outPos++] = (imgSize >> 16) & 0xff;
  png[outPos++] = (imgSize >> 8) & 0xff;
  png[outPos++] = imgSize & 0xff;
  // Bit depth 8, ColorType 0 (Grayscale), Compression 0, Filter 0, Interlace 0
  png[outPos++] = 8;
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = 0;
  const ihdrCrc = crc32(png, ihdrTypePos, 4 + ihdrLen);
  png[outPos++] = (ihdrCrc >> 24) & 0xff;
  png[outPos++] = (ihdrCrc >> 16) & 0xff;
  png[outPos++] = (ihdrCrc >> 8) & 0xff;
  png[outPos++] = ihdrCrc & 0xff;

  // 3. IDAT Chunk
  png[outPos++] = (idatPayloadLen >> 24) & 0xff;
  png[outPos++] = (idatPayloadLen >> 16) & 0xff;
  png[outPos++] = (idatPayloadLen >> 8) & 0xff;
  png[outPos++] = idatPayloadLen & 0xff;
  const idatTypePos = outPos;
  png.set([73, 68, 65, 84], outPos); // 'IDAT'
  outPos += 4;
  png.set(idatPayload, outPos);
  outPos += idatPayloadLen;
  const idatCrc = crc32(png, idatTypePos, 4 + idatPayloadLen);
  png[outPos++] = (idatCrc >> 24) & 0xff;
  png[outPos++] = (idatCrc >> 16) & 0xff;
  png[outPos++] = (idatCrc >> 8) & 0xff;
  png[outPos++] = idatCrc & 0xff;

  // 4. IEND Chunk
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = 0;
  png[outPos++] = 0;
  const iendTypePos = outPos;
  png.set([73, 69, 78, 68], outPos); // 'IEND'
  outPos += 4;
  const iendCrc = crc32(png, iendTypePos, 4);
  png[outPos++] = (iendCrc >> 24) & 0xff;
  png[outPos++] = (iendCrc >> 16) & 0xff;
  png[outPos++] = (iendCrc >> 8) & 0xff;
  png[outPos++] = iendCrc & 0xff;

  return png;
}

/**
 * Converts a Uint8Array buffer into a Base64 string safely.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const globalAny = globalThis as any;
  if (globalAny.Buffer) {
    return globalAny.Buffer.from(bytes).toString('base64');
  }

  let base64 = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    base64 += BASE64_CHARS[b0 >> 2];
    base64 += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    base64 += i + 1 < len ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    base64 += i + 2 < len ? BASE64_CHARS[b2 & 63] : '=';
  }
  return base64;
}
