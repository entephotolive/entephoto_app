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
 * Extracts initials dynamically from an event title for display in the QR code centre badge.
 *
 * Rules:
 * - Trim whitespace and handle uppercase and lowercase titles.
 * - Recognize "and" and "&" as separators between two names or title parts.
 * - When a title contains two sides separated by one of these delimiters, extract the first
 *   meaningful letter from each side and join them with "&" (e.g. "bride and groom" -> "B&G").
 * - When there is no pair separator, use the first meaningful letter of the title (e.g. "Wedding" -> "W").
 * - Ignore leading spaces and punctuation when extracting initials.
 * - Fall back to "E" (Event) for missing, empty, or malformed titles.
 */
export function getEventInitials(title?: string | null): string {
  if (!title || typeof title !== 'string') {
    return 'E';
  }

  const clean = title.trim();
  if (!clean || clean.toLowerCase() === 'and' || clean === '&') {
    return 'E';
  }

  const parts = clean.split(/\s+and\s+|\s*&\s*/i);
  if (parts.length >= 2) {
    const firstPart = parts[0];
    const secondPart = parts.slice(1).join(' ');

    const firstCharMatch = firstPart.match(/[a-zA-Z0-9]/);
    const secondCharMatch = secondPart.match(/[a-zA-Z0-9]/);

    const firstChar = firstCharMatch ? firstCharMatch[0].toUpperCase() : '';
    const secondChar = secondCharMatch ? secondCharMatch[0].toUpperCase() : '';

    if (firstChar && secondChar) {
      return `${firstChar}&${secondChar}`;
    }
    if (firstChar) {
      return firstChar;
    }
    if (secondChar) {
      return secondChar;
    }
  }

  const match = clean.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : 'E';
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

// 5x7 bitmapped font for uppercase alphanumeric glyphs and &
const FONT_5X7: Record<string, number[]> = {
  A: [0x7c, 0x12, 0x11, 0x12, 0x7c],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x7f, 0x20, 0x18, 0x20, 0x7f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
};

function isInsideRoundedRect(
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  rad: number,
): boolean {
  if (px < rx || px >= rx + rw || py < ry || py >= ry + rh) {
    return false;
  }
  if (rad <= 0) {
    return true;
  }

  const left = px < rx + rad;
  const right = px >= rx + rw - rad;
  const top = py < ry + rad;
  const bottom = py >= ry + rh - rad;

  if (left && top) {
    const dx = px - (rx + rad);
    const dy = py - (ry + rad);
    return dx * dx + dy * dy <= rad * rad;
  }
  if (right && top) {
    const dx = px - (rx + rw - rad - 1);
    const dy = py - (ry + rad);
    return dx * dx + dy * dy <= rad * rad;
  }
  if (left && bottom) {
    const dx = px - (rx + rad);
    const dy = py - (ry + rh - rad - 1);
    return dx * dx + dy * dy <= rad * rad;
  }
  if (right && bottom) {
    const dx = px - (rx + rw - rad - 1);
    const dy = py - (ry + rh - rad - 1);
    return dx * dx + dy * dy <= rad * rad;
  }
  return true;
}

export interface QrLayoutModule {
  px: number;
  py: number;
  tl: boolean;
  tr: boolean;
  br: boolean;
  bl: boolean;
}

export interface QrLayoutFillet {
  px: number;
  py: number;
  corner: 'tl' | 'tr' | 'bl' | 'br';
}

export interface QrLayoutFinder {
  fx: number;
  fy: number;
}

export interface QrLayoutBadge {
  cx: number;
  cy: number;
  r: number;
  diameterRatio: number;
  initials: string;
}

export interface QrLayoutModel {
  modSize: number;
  totalModules: number;
  modules: QrLayoutModule[];
  fillets: QrLayoutFillet[];
  finders: QrLayoutFinder[];
  badge: QrLayoutBadge;
}

/**
 * Shared mathematical geometry layout for both SVG display and PNG rasterization.
 * Computes connected organic module contours, concave corner fillets, rounded finders,
 * and the compact circular centre badge.
 */
export function getQrLayout(url: string, quietZone = 4, initials?: string): QrLayoutModel {
  // Use Error Correction Level High (2) for 30% recovery capacity
  const matrix = toQR(url, 2);
  const modSize = Math.round(Math.sqrt(matrix.length));
  if (modSize === 0) {
    throw new Error('Failed to generate QR matrix: empty output.');
  }

  const totalModules = modSize + quietZone * 2;
  const centerMod = modSize / 2;

  // Compact badge ~15-16% of QR symbol width (diameter ~7.8 modules, radius ~3.9 modules for 49x49)
  const badgeRadius = Math.max(3.5, modSize * 0.08);

  const isFinder = (mx: number, my: number): boolean => {
    if (mx < 8 && my < 8) return true;
    if (mx >= modSize - 8 && my < 8) return true;
    if (mx < 8 && my >= modSize - 8) return true;
    return false;
  };

  const isBadge = (mx: number, my: number): boolean => {
    const dx = mx + 0.5 - centerMod;
    const dy = my + 0.5 - centerMod;
    return dx * dx + dy * dy <= badgeRadius * badgeRadius;
  };

  const getCell = (x: number, y: number): number => {
    if (x < 0 || x >= modSize || y < 0 || y >= modSize) return 0;
    return matrix[y * modSize + x] ? 1 : 0;
  };

  // 1. Data modules with neighbor-aware corner rounding
  const modules: QrLayoutModule[] = [];
  for (let my = 0; my < modSize; my++) {
    for (let mx = 0; mx < modSize; mx++) {
      if (isFinder(mx, my) || isBadge(mx, my)) continue;
      if (!getCell(mx, my)) continue;

      const T = getCell(mx, my - 1) && !isFinder(mx, my - 1) && !isBadge(mx, my - 1);
      const B = getCell(mx, my + 1) && !isFinder(mx, my + 1) && !isBadge(mx, my + 1);
      const L = getCell(mx - 1, my) && !isFinder(mx - 1, my) && !isBadge(mx - 1, my);
      const R = getCell(mx + 1, my) && !isFinder(mx + 1, my) && !isBadge(mx + 1, my);

      modules.push({
        px: mx + quietZone,
        py: my + quietZone,
        tl: !T && !L,
        tr: !T && !R,
        br: !B && !R,
        bl: !B && !L,
      });
    }
  }

  // 2. Concave fillets on white cells surrounded by dark modules
  const fillets: QrLayoutFillet[] = [];
  for (let my = 0; my < modSize; my++) {
    for (let mx = 0; mx < modSize; mx++) {
      if (isFinder(mx, my) || isBadge(mx, my)) continue;
      if (getCell(mx, my)) continue; // white cells only

      const T = getCell(mx, my - 1) && !isFinder(mx, my - 1) && !isBadge(mx, my - 1);
      const B = getCell(mx, my + 1) && !isFinder(mx, my + 1) && !isBadge(mx, my + 1);
      const L = getCell(mx - 1, my) && !isFinder(mx - 1, my) && !isBadge(mx - 1, my);
      const R = getCell(mx + 1, my) && !isFinder(mx + 1, my) && !isBadge(mx + 1, my);

      const px = mx + quietZone;
      const py = my + quietZone;

      if (T && L) fillets.push({ px, py, corner: 'tl' });
      if (T && R) fillets.push({ px, py, corner: 'tr' });
      if (B && L) fillets.push({ px, py, corner: 'bl' });
      if (B && R) fillets.push({ px, py, corner: 'br' });
    }
  }

  // 3. 3 Rounded Finder patterns
  const finders: QrLayoutFinder[] = [
    { fx: quietZone, fy: quietZone },
    { fx: quietZone + modSize - 7, fy: quietZone },
    { fx: quietZone, fy: quietZone + modSize - 7 },
  ];

  return {
    modSize,
    totalModules,
    modules,
    fillets,
    finders,
    badge: {
      cx: quietZone + centerMod,
      cy: quietZone + centerMod,
      r: badgeRadius,
      diameterRatio: (badgeRadius * 2) / totalModules,
      initials: initials ? initials.trim() : '',
    },
  };
}

/**
 * Generates an SVG path string from a QrLayoutModel, creating bold, continuous organic shapes
 * with rounded module caps and smooth concave fillets.
 */
export function generateQrSvgPath(layout: QrLayoutModel): string {
  let d = '';
  const r = 0.5;

  for (const m of layout.modules) {
    const x0 = m.px;
    const x1 = m.px + 1;
    const y0 = m.py;
    const y1 = m.py + 1;

    d += `M${x0 + (m.tl ? r : 0)},${y0} `;
    d += `L${x1 - (m.tr ? r : 0)},${y0} `;
    if (m.tr) d += `A${r} ${r} 0 0 1 ${x1},${y0 + r} `;
    d += `L${x1},${y1 - (m.br ? r : 0)} `;
    if (m.br) d += `A${r} ${r} 0 0 1 ${x1 - r},${y1} `;
    d += `L${x0 + (m.bl ? r : 0)},${y1} `;
    if (m.bl) d += `A${r} ${r} 0 0 1 ${x0},${y1 - r} `;
    d += `L${x0},${y0 + (m.tl ? r : 0)} `;
    if (m.tl) d += `A${r} ${r} 0 0 1 ${x0 + r},${y0} `;
    d += 'Z ';
  }

  const rf = 0.35;
  for (const f of layout.fillets) {
    const px = f.px;
    const py = f.py;
    if (f.corner === 'tl') {
      d += `M${px},${py} L${px + rf},${py} A${rf} ${rf} 0 0 0 ${px},${py + rf} Z `;
    } else if (f.corner === 'tr') {
      d += `M${px + 1},${py} L${px + 1},${py + rf} A${rf} ${rf} 0 0 0 ${px + 1 - rf},${py} Z `;
    } else if (f.corner === 'bl') {
      d += `M${px},${py + 1} L${px},${py + 1 - rf} A${rf} ${rf} 0 0 0 ${px + rf},${py + 1} Z `;
    } else if (f.corner === 'br') {
      d += `M${px + 1},${py + 1} L${px + 1 - rf},${py + 1} A${rf} ${rf} 0 0 0 ${px + 1},${py + 1 - rf} Z `;
    }
  }

  return d;
}

/**
 * Generates an uncompressed high-resolution PNG image directly from a QR URL
 * matching the EntePhoto modern organic QR design:
 * - Continuous connected rounded modules on pure white background
 * - Generously rounded finder patterns
 * - Generous quiet zone
 * - Compact circular white centre badge with dynamic event initials in bold dark typography
 * - High error correction (ECLevel.H) for 100% reliable scanning
 *
 * @param url - Destination live event URL to encode
 * @param scale - Pixels per QR module (default 20 -> ~1140x1140px)
 * @param quietZone - Quiet-zone margin in modules (default 4)
 * @param initials - Event initials to render in the centre badge (e.g. "B&G")
 * @returns Uint8Array containing complete PNG file bytes
 */
export function generateQrPngBytes(
  url: string,
  scale = 20,
  quietZone = 4,
  initials?: string,
): Uint8Array {
  const layout = getQrLayout(url, quietZone, initials);
  const imgSize = layout.totalModules * scale;

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

  const setPixel = (px: number, py: number, val: number) => {
    if (px >= 0 && px < imgSize && py >= 0 && py < imgSize) {
      rawData[py * rowBytes + 1 + px] = val;
    }
  };

  const halfScale = scale / 2;
  const radSq = halfScale * halfScale;

  // 1. Draw continuous connected data modules
  for (const m of layout.modules) {
    const cellX = m.px * scale;
    const cellY = m.py * scale;

    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        let dark = true;
        if (dx < halfScale && dy < halfScale) {
          if (m.tl) {
            const rx = dx - halfScale;
            const ry = dy - halfScale;
            if (rx * rx + ry * ry > radSq) dark = false;
          }
        } else if (dx >= halfScale && dy < halfScale) {
          if (m.tr) {
            const rx = dx - halfScale;
            const ry = dy - halfScale;
            if (rx * rx + ry * ry > radSq) dark = false;
          }
        } else if (dx < halfScale && dy >= halfScale) {
          if (m.bl) {
            const rx = dx - halfScale;
            const ry = dy - halfScale;
            if (rx * rx + ry * ry > radSq) dark = false;
          }
        } else {
          if (m.br) {
            const rx = dx - halfScale;
            const ry = dy - halfScale;
            if (rx * rx + ry * ry > radSq) dark = false;
          }
        }
        if (dark) {
          setPixel(cellX + dx, cellY + dy, 0);
        }
      }
    }
  }

  // 2. Draw concave inner fillets on white cells
  const rf = Math.round(0.35 * scale);
  const rfSq = rf * rf;
  for (const f of layout.fillets) {
    const cellX = f.px * scale;
    const cellY = f.py * scale;

    if (f.corner === 'tl') {
      for (let dy = 0; dy < rf; dy++) {
        for (let dx = 0; dx < rf; dx++) {
          const rx = dx - rf;
          const ry = dy - rf;
          if (rx * rx + ry * ry >= rfSq) setPixel(cellX + dx, cellY + dy, 0);
        }
      }
    } else if (f.corner === 'tr') {
      for (let dy = 0; dy < rf; dy++) {
        for (let dx = scale - rf; dx < scale; dx++) {
          const rx = dx - (scale - rf);
          const ry = dy - rf;
          if (rx * rx + ry * ry >= rfSq) setPixel(cellX + dx, cellY + dy, 0);
        }
      }
    } else if (f.corner === 'bl') {
      for (let dy = scale - rf; dy < scale; dy++) {
        for (let dx = 0; dx < rf; dx++) {
          const rx = dx - rf;
          const ry = dy - (scale - rf);
          if (rx * rx + ry * ry >= rfSq) setPixel(cellX + dx, cellY + dy, 0);
        }
      }
    } else if (f.corner === 'br') {
      for (let dy = scale - rf; dy < scale; dy++) {
        for (let dx = scale - rf; dx < scale; dx++) {
          const rx = dx - (scale - rf);
          const ry = dy - (scale - rf);
          if (rx * rx + ry * ry >= rfSq) setPixel(cellX + dx, cellY + dy, 0);
        }
      }
    }
  }

  // 3. Draw 3 rounded Finder patterns
  for (const f of layout.finders) {
    const rx = f.fx * scale;
    const ry = f.fy * scale;
    const size7 = 7 * scale;
    const size5 = 5 * scale;
    const size3 = 3 * scale;
    const offset1 = 1 * scale;
    const offset2 = 2 * scale;

    const rOuter = Math.round(2.2 * scale);
    const rMid = Math.round(1.5 * scale);
    const rCore = Math.round(1.0 * scale);

    for (let py = 0; py < size7; py++) {
      for (let px = 0; px < size7; px++) {
        const absX = rx + px;
        const absY = ry + py;

        const inOuter = isInsideRoundedRect(px, py, 0, 0, size7, size7, rOuter);
        const inMid = isInsideRoundedRect(px, py, offset1, offset1, size5, size5, rMid);
        const inCore = isInsideRoundedRect(px, py, offset2, offset2, size3, size3, rCore);

        if (inCore) {
          setPixel(absX, absY, 0); // Black core
        } else if (inMid) {
          setPixel(absX, absY, 255); // White separator
        } else if (inOuter) {
          setPixel(absX, absY, 0); // Black outer frame
        }
      }
    }
  }

  // 4. Draw Center circular white badge
  const badgeR = layout.badge.r * scale;
  const cx = layout.badge.cx * scale;
  const cy = layout.badge.cy * scale;
  const minPy = Math.max(0, Math.floor(cy - badgeR - 2));
  const maxPy = Math.min(imgSize - 1, Math.ceil(cy + badgeR + 2));
  const minPx = Math.max(0, Math.floor(cx - badgeR - 2));
  const maxPx = Math.min(imgSize - 1, Math.ceil(cx + badgeR + 2));
  for (let py = minPy; py <= maxPy; py++) {
    for (let px = minPx; px <= maxPx; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= badgeR * badgeR) {
        setPixel(px, py, 255);
      }
    }
  }

  // 5. Render Initials in bold dark typography inside the centre badge
  const text = layout.badge.initials;
  if (text) {
    const chars = text.split('');
    const charW = 5;
    const charH = 7;
    const charSpacing = 1;
    const totalFontW = chars.length * charW + (chars.length - 1) * charSpacing;
    const totalFontH = charH;

    const maxTargetW = badgeR * 1.35;
    const fontPixelScale = Math.max(2, Math.floor(maxTargetW / totalFontW));
    const renderedW = totalFontW * fontPixelScale;
    const renderedH = totalFontH * fontPixelScale;
    const textStartX = Math.round(cx - renderedW / 2);
    const textStartY = Math.round(cy - renderedH / 2);

    let curX = textStartX;
    for (const char of chars) {
      const glyph = FONT_5X7[char] || FONT_5X7['E'];
      for (let col = 0; col < charW; col++) {
        const colBits = glyph[col] || 0;
        for (let row = 0; row < charH; row++) {
          if ((colBits >> row) & 1) {
            for (let dy = 0; dy < fontPixelScale; dy++) {
              for (let dx = 0; dx < fontPixelScale; dx++) {
                const py = textStartY + row * fontPixelScale + dy;
                const px = curX + col * fontPixelScale + dx;
                setPixel(px, py, 0); // Bold black typography
              }
            }
          }
        }
      }
      curX += (charW + charSpacing) * fontPixelScale;
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
