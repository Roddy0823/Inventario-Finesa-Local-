import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDockerExecutable,
  assertNoExistingInstallation,
  assertMatchingRuntime,
} from "./local-docker.mjs";

test("Docker admite instalación en PATH y ruta estándar en ambos lanzadores", () => {
  assert.equal(resolveDockerExecutable({ platform: "win32", exists: () => false }), "docker");
  assert.match(resolveDockerExecutable({ platform: "win32", exists: () => true }), /docker\.exe$/);
  assert.equal(resolveDockerExecutable({ platform: "linux" }), "docker");
});
test("preparar no regenera claves cuando sobreviven datos o contenedores", () => {
  assert.throws(
    () => assertNoExistingInstallation("finesa-local_finesa-db\n", ""),
    /datos o contenedores/,
  );
  assert.throws(() => assertNoExistingInstallation("", "supabase-db"), /datos o contenedores/);
  assert.doesNotThrow(() => assertNoExistingInstallation("", ""));
});
test("iniciar rechaza configuración distinta de la utilizada por Compose", () => {
  assert.doesNotThrow(() =>
    assertMatchingRuntime("/runtime/supabase", "/runtime/supabase\n", "linux"),
  );
  assert.throws(
    () => assertMatchingRuntime("/runtime/new", "/runtime/original", "linux"),
    /otra carpeta/,
  );
});
