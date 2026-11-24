import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

export async function checkLocalRealtime({
  url,
  anonKey,
  timeoutMs = 1500,
  createSocket = (endpoint) => new WebSocket(endpoint),
}) {
  // El gateway bloquea la API administrativa de tenants. Comprobar el canal
  // publico real sin mensajes de negocio, presencia ni suscripciones a filas.
  // El protocolo Phoenix v2 no necesita sesion persistente ni timers del SDK.
  const endpoint = new URL("/realtime/v1/websocket", url);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  endpoint.searchParams.set("apikey", anonKey);
  endpoint.searchParams.set("vsn", "2.0.0");
  const topic = `realtime:finesa-readiness-${process.pid}-${Date.now()}`;
  await new Promise((resolve, reject) => {
    const socket = createSocket(endpoint);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (ok) resolve();
      else reject(new Error("Realtime no esta disponible"));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.addEventListener("open", () => {
      if (settled) return;
      socket.send(
        JSON.stringify([
          "1",
          "1",
          topic,
          "phx_join",
          {
            config: {
              broadcast: { ack: false, self: false },
              presence: { enabled: false },
              postgres_changes: [],
              private: false,
            },
            access_token: anonKey,
          },
        ]),
      );
    });
    socket.addEventListener("message", (event) => {
      try {
        const reply = JSON.parse(event.data);
        if (reply[1] === "1" && reply[2] === topic && reply[3] === "phx_reply") {
          finish(reply[4]?.status === "ok");
        }
      } catch {
        finish(false);
      }
    });
    socket.addEventListener("error", () => finish(false));
    socket.addEventListener("close", () => finish(false));
  });
}

export async function canReuseLocalApp({
  alreadyRunning,
  checkOnly,
  runtime,
  timeoutMs = 1500,
  apiProbe = waitForLocalApi,
  realtimeProbe = checkLocalRealtime,
}) {
  if (!alreadyRunning || checkOnly) return false;
  try {
    const config = parseEnv(readFileSync(join(runtime, "supabase", ".env"), "utf8"));
    if (!config.SUPABASE_PUBLIC_URL || !config.ANON_KEY) return false;
    const options = { url: config.SUPABASE_PUBLIC_URL, anonKey: config.ANON_KEY, timeoutMs };
    const results = await Promise.allSettled([
      apiProbe({ ...options, requestTimeoutMs: timeoutMs, pollIntervalMs: 100 }),
      realtimeProbe(options),
    ]);
    return results.every((result) => result.status === "fulfilled");
  } catch {
    // Volver al arranque normal, que valida la identidad y repara los servicios.
    // No imprimir errores de terceros que puedan contener claves o URLs.
    return false;
  }
}

const probes = [
  { name: "Autenticacion", path: "/auth/v1/health", method: "GET" },
  // HEAD + limit=0 comprueba la API y el esquema de la app sin leer datos.
  { name: "Datos", path: "/rest/v1/profiles?select=id&limit=0", method: "HEAD" },
  { name: "Archivos", path: "/storage/v1/status", method: "HEAD" },
];

export async function waitForLocalApi({
  url,
  anonKey,
  timeoutMs = 15000,
  requestTimeoutMs = 2500,
  pollIntervalMs = 500,
  fetchImpl = fetch,
}) {
  const deadline = Date.now() + timeoutMs;
  let details = [];
  do {
    // Envoy puede aceptar TCP antes de que sus rutas esten listas. Comprobar
    // las tres APIs evita presentar el ingreso mientras datos o archivos fallan.
    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          const response = await fetchImpl(new URL(probe.path, url), {
            method: probe.method,
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
            redirect: "error",
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now())),
            ),
          });
          await response.body?.cancel();
          return {
            ok: response.ok,
            permanent: response.status >= 400 && response.status < 500,
            detail: `${probe.name}: HTTP ${response.status}`,
          };
        } catch {
          // Nunca imprimir cabeceras, claves ni mensajes de transporte que
          // puedan incluir la URL o las credenciales de la peticion.
          return { ok: false, permanent: false, detail: `${probe.name}: sin respuesta` };
        }
      }),
    );
    if (results.every((result) => result.ok)) return;
    details = results.filter((result) => !result.ok).map((result) => result.detail);
    if (results.some((result) => result.permanent)) break;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  } while (Date.now() < deadline);

  throw new Error(
    `Los contenedores iniciaron, pero las APIs de Finesa no estan listas (${details.join("; ")}). Revise los servicios antes de volver a iniciar.`,
  );
}
