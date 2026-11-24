import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { waitForLocalApi } from "./local-readiness.mjs";

async function withServer(handler, run) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("sondea las APIs en paralelo y sin descargar filas de la aplicacion", async () => {
  const requests = [];
  const pending = [];
  await withServer(
    (request, response) => {
      requests.push({
        url: request.url,
        method: request.method,
        key: request.headers.apikey,
        authorization: request.headers.authorization,
      });
      pending.push(response);
      // Solo responder cuando llegaron todas: un sondeo secuencial fallaria.
      if (pending.length === 3) pending.forEach((item) => item.end());
    },
    async (url) => {
      await waitForLocalApi({ url, anonKey: "test-only", requestTimeoutMs: 1000 });
    },
  );
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.key === "test-only"));
  assert.ok(requests.every((request) => request.authorization === "Bearer test-only"));
  assert.deepEqual(requests.map(({ url, method }) => [url, method]).sort(), [
    ["/auth/v1/health", "GET"],
    ["/rest/v1/profiles?select=id&limit=0", "HEAD"],
    ["/storage/v1/status", "HEAD"],
  ]);
});

test("no declara listo un gateway que responde pero sus datos aun devuelven 503", async () => {
  let dataRequests = 0;
  await withServer(
    (request, response) => {
      if (request.url.startsWith("/rest/")) {
        dataRequests += 1;
        response.statusCode = dataRequests === 1 ? 503 : 200;
      }
      response.end();
    },
    async (url) => {
      await waitForLocalApi({ url, anonKey: "test-only", pollIntervalMs: 1 });
    },
  );
  assert.equal(dataRequests, 2);
});

test("un error de credenciales detiene el arranque sin reintentar ni exponer la clave", async () => {
  let attempts = 0;
  await withServer(
    (_request, response) => {
      attempts += 1;
      response.statusCode = 401;
      response.end();
    },
    async (url) => {
      await assert.rejects(waitForLocalApi({ url, anonKey: "never-log-this" }), (error) => {
        assert.match(error.message, /HTTP 401/);
        assert.doesNotMatch(error.message, /never-log-this/);
        return true;
      });
    },
  );
  assert.equal(attempts, 3);
});

test("un servicio sin respuesta agota su plazo y no se confunde con listo", async () => {
  await withServer(
    () => {},
    async (url) => {
      const start = Date.now();
      await assert.rejects(
        waitForLocalApi({
          url,
          anonKey: "test-only",
          timeoutMs: 80,
          requestTimeoutMs: 30,
          pollIntervalMs: 1,
        }),
        /no estan listas.*sin respuesta/,
      );
      assert.ok(Date.now() - start < 2000);
    },
  );
});

test("no sigue redirecciones de un endpoint de salud a otro destino", async () => {
  let redirected = 0;
  await withServer(
    (request, response) => {
      if (request.url === "/unexpected") redirected += 1;
      response.writeHead(302, { Location: "/unexpected" }).end();
    },
    async (url) => {
      await assert.rejects(
        waitForLocalApi({ url, anonKey: "test-only", timeoutMs: 80, pollIntervalMs: 1 }),
        /no estan listas/,
      );
    },
  );
  assert.equal(redirected, 0);
});
