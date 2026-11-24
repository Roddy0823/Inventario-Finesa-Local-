import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { canReuseLocalApp, checkLocalRealtime } from "./local-readiness.mjs";

const runtime = mkdtempSync(join(tmpdir(), "finesa-reuse-test-"));
mkdirSync(join(runtime, "supabase"));
writeFileSync(
  join(runtime, "supabase", ".env"),
  'SUPABASE_PUBLIC_URL="http://localhost:8000"\nANON_KEY=test-only\n',
);
after(() => {
  if (dirname(resolve(runtime)) !== resolve(tmpdir())) throw new Error("Ruta inesperada");
  rmSync(runtime, { recursive: true });
});

test("reutiliza solo la app existente con las APIs y Realtime listos", async () => {
  const options = [];
  const probe = async (input) => {
    options.push(input);
  };
  assert.equal(
    await canReuseLocalApp({
      alreadyRunning: true,
      runtime,
      apiProbe: probe,
      realtimeProbe: probe,
    }),
    true,
  );
  assert.equal(options.length, 2);
  assert.ok(
    options.every(
      (input) => input.url === "http://localhost:8000" && input.anonKey === "test-only",
    ),
  );
});

test("el arranque en frio y --check conservan el camino completo de Docker", async () => {
  let probes = 0;
  const probe = async () => {
    probes += 1;
  };
  for (const flags of [{ alreadyRunning: false }, { alreadyRunning: true, checkOnly: true }]) {
    assert.equal(
      await canReuseLocalApp({ ...flags, runtime, apiProbe: probe, realtimeProbe: probe }),
      false,
    );
  }
  assert.equal(probes, 0);
});

test("fallos HTTP o Realtime fuerzan el arranque normal sin propagar mensajes sensibles", async () => {
  const ready = async () => {};
  const failed = async () => {
    throw new Error("never-print-secret-api-key");
  };
  for (const probes of [
    { apiProbe: failed, realtimeProbe: ready },
    { apiProbe: ready, realtimeProbe: failed },
  ]) {
    assert.equal(await canReuseLocalApp({ alreadyRunning: true, runtime, ...probes }), false);
  }
  assert.equal(
    await canReuseLocalApp({ alreadyRunning: true, runtime: join(runtime, "missing") }),
    false,
  );
});

class FakeSocket extends EventTarget {
  sent = [];
  closes = 0;
  constructor(reply) {
    super();
    this.reply = reply;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(payload) {
    const data = JSON.parse(payload);
    this.sent.push(data);
    if (this.reply) {
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify([data[0], data[1], data[2], "phx_reply", { status: this.reply }]),
          }),
        ),
      );
    }
  }
  close() {
    this.closes += 1;
  }
}

test("Realtime requiere confirmacion del canal y cierra sin mensajes de negocio ni suscripcion a datos", async () => {
  let socket;
  let endpoint;
  await checkLocalRealtime({
    url: "http://localhost:8000",
    anonKey: "test-only",
    createSocket: (url) => {
      endpoint = url;
      socket = new FakeSocket("ok");
      return socket;
    },
  });
  assert.equal(endpoint.protocol, "ws:");
  assert.equal(endpoint.searchParams.get("vsn"), "2.0.0");
  assert.equal(socket.closes, 1);
  assert.equal(socket.sent.length, 1);
  assert.equal(socket.sent[0][3], "phx_join");
  assert.deepEqual(socket.sent[0][4].config.postgres_changes, []);
  assert.equal(socket.sent[0][4].config.presence.enabled, false);
});

test("abrir solo el socket no basta; sin confirmacion expira y cierra", async () => {
  let socket;
  await assert.rejects(
    checkLocalRealtime({
      url: "http://localhost:8000",
      anonKey: "test-only",
      timeoutMs: 30,
      createSocket: () => (socket = new FakeSocket()),
    }),
    /Realtime no esta disponible/,
  );
  assert.equal(socket.closes, 1);
});

test("una respuesta de rechazo no se confunde con un canal listo", async () => {
  let socket;
  await assert.rejects(
    checkLocalRealtime({
      url: "http://localhost:8000",
      anonKey: "test-only",
      createSocket: () => (socket = new FakeSocket("error")),
    }),
    /Realtime no esta disponible/,
  );
  assert.equal(socket.closes, 1);
});
