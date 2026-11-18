import { createHash } from "node:crypto";

export function migrationChecksums(source) {
  const normalized = source.replace(/\r\n/g, "\n");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  return {
    canonical: hash(normalized),
    // Compatibilidad con instalaciones previas que guardaron los bytes de Windows.
    accepted: [
      ...new Set([hash(normalized), hash(normalized.replace(/\n/g, "\r\n")), hash(source)]),
    ],
  };
}
