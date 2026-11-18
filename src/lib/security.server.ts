import { inflateSync } from "node:zlib";

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

let lastCleanup = Date.now();

function cleanupBuckets(now: number) {
  if (now - lastCleanup < 60_000 && rateBuckets.size < 2000) return;
  lastCleanup = now;
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}

/**
 * Limitador de tasa en memoria por ventana deslizante fija (IP + acción).
 * Protege endpoints públicos y sensibles contra fuerza bruta y enumeración.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  cleanupBuckets(now);

  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  entry.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const IHDR_ASCII = [0x49, 0x48, 0x44, 0x52] as const;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Valida estrictamente que un Data URL sea una imagen PNG legítima
 * comprobando su cabecera binaria (Magic Bytes + chunk IHDR) y límites de tamaño.
 */
export function validarPngBase64(
  dataUrl: string,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  if (dataUrl.length > 3_000_000)
    return { ok: false, error: "La imagen de la firma excede el tamaño máximo permitido (2 MB)." };
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m || !m[1]) {
    return { ok: false, error: "Formato de firma inválido (se requiere imagen PNG)." };
  }

  let bytes: Uint8Array;
  try {
    const cleanBase64 = m[1].replace(/\s+/g, "");
    bytes = Uint8Array.from(atob(cleanBase64), (c) => c.charCodeAt(0));
  } catch {
    return { ok: false, error: "Codificación base64 de la firma inválida." };
  }

  if (bytes.length < 500) {
    return { ok: false, error: "El trazo de la firma está vacío o es demasiado corto." };
  }
  if (bytes.length > 2_000_000) {
    return { ok: false, error: "La imagen de la firma excede el tamaño máximo permitido (2 MB)." };
  }

  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) {
      return { ok: false, error: "El archivo enviado no corresponde a una imagen PNG válida." };
    }
  }

  for (let i = 0; i < IHDR_ASCII.length; i++) {
    if (bytes[12 + i] !== IHDR_ASCII[i]) {
      return { ok: false, error: "Cabecera IHDR de imagen PNG inválida." };
    }
  }

  // Validar antes de pdf-lib: el tamaño comprimido no limita la memoria que
  // puede reservar un decodificador a partir de las dimensiones IHDR.
  const invalid = {
    ok: false as const,
    error: "La estructura de la imagen PNG es inválida o no está soportada.",
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return invalid;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4_000_000) {
    return {
      ok: false,
      error:
        "Las dimensiones de la firma exceden el máximo permitido (4096 por lado y 4 millones de píxeles).",
    };
  }
  const depth = bytes[24]!;
  const color = bytes[25]!;
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!channels[color] || !depths.includes(depth) || bytes[26] || bytes[27] || bytes[28])
    return invalid;
  const idats: Uint8Array[] = [];
  let ended = false;
  let palette = false;
  let idatEnded = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) return invalid;
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return invalid;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) return invalid;
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) return invalid;
    if (type === "IHDR" && offset !== 8) return invalid;
    if (["acTL", "fcTL", "fdAT"].includes(type)) return invalid;
    if (type === "PLTE") {
      if (palette || idats.length || !length || length > 768 || length % 3) return invalid;
      palette = true;
    } else if (type === "IDAT") {
      if (idatEnded || (color === 3 && !palette)) return invalid;
      idats.push(bytes.subarray(offset + 8, end - 4));
    } else if (idats.length) idatEnded = true;
    if (type === "IEND") {
      if (length || end !== bytes.length || !idats.length) return invalid;
      ended = true;
    } else if (!["IHDR", "PLTE", "IDAT"].includes(type) && /^[A-Z]/.test(type)) return invalid;
    offset = end;
  }
  if (!ended) return invalid;
  try {
    const rowLength = Math.ceil((width * channels[color]! * depth) / 8) + 1;
    const expected = rowLength * height;
    const raw = inflateSync(Buffer.concat(idats), { maxOutputLength: expected });
    if (raw.length !== expected) return invalid;
    for (let offset = 0; offset < raw.length; offset += rowLength)
      if (raw[offset]! > 4) return invalid;
  } catch {
    return invalid;
  }

  return { ok: true, bytes };
}

/**
 * Valida que la contraseña cumpla con los requisitos de complejidad corporativa.
 */
export function validarPoliticaPassword(password: string): string | null {
  if (password.length < 8) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }
  if (password.length > 72) {
    return "La contraseña no puede superar los 72 caracteres.";
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return "La contraseña debe incluir al menos una letra y un número o símbolo.";
  }
  return null;
}
