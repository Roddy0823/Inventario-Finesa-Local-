import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** No emitir enlaces que apunten a localhost o a una IP anterior del equipo. */
export function signatureOrigin(): string | null {
  const configured = process.env["PUBLIC_SIGNATURE_ORIGIN"]?.trim();
  const local = process.env["LOCAL_ONLY"] === "true";
  if (!configured) {
    if (local)
      throw new Error(
        "La firma desde otros equipos no está configurada. Configure signatureOrigin en lan.json y reinicie la aplicación.",
      );
    return null;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("La dirección configurada para los enlaces de firma no es válida.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("La dirección de firma debe contener únicamente protocolo, servidor y puerto.");

  if (local) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "::1" || /^127\./.test(host))
      throw new Error(
        "La dirección de firma debe ser accesible desde otros equipos, no localhost.",
      );
    if (isIP(host)) {
      const current = Object.values(networkInterfaces()).flatMap((rows) => rows ?? []);
      if (!current.some((address) => address.address === host && !address.internal))
        throw new Error(
          "La IP configurada para firmar ya no pertenece a este equipo. Actualice signatureOrigin en lan.json y la regla Finesa-Firmas-LAN, y reinicie la aplicación.",
        );
    }
  }
  return url.origin;
}
