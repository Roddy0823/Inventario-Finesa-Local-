import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveLocalRuntime } from "./local-runtime.mjs";

const fixtures = mkdtempSync(join(tmpdir(), "finesa-runtime-test-"));
after(() => {
  if (dirname(resolve(fixtures)) !== resolve(tmpdir()))
    throw new Error("Ruta de limpieza inesperada");
  rmSync(fixtures, { recursive: true, force: true });
});
function makeConfig(root) {
  mkdirSync(join(root, "supabase"), { recursive: true });
  writeFileSync(join(root, "supabase", ".env"), "# fixture; no credentials\n");
  return dirname(dirname(realpathSync.native(join(root, "supabase", ".env"))));
}

test("encuentra la configuracion MSIX desde una terminal externa", () => {
  const localData = join(fixtures, "external");
  const expected = makeConfig(
    join(localData, "Packages", "OpenAI.Codex_fixture", "LocalCache", "Local", "FinesaInventario"),
  );
  assert.equal(
    resolveLocalRuntime({ env: { LOCALAPPDATA: localData }, platform: "win32" }),
    expected,
  );
});

test("respeta el override y rechaza uno incorrecto sin cambiar de instalacion", () => {
  const localData = join(fixtures, "override");
  makeConfig(join(localData, "FinesaInventario"));
  const expected = makeConfig(join(localData, "chosen"));
  assert.equal(
    resolveLocalRuntime({ env: { LOCALAPPDATA: localData, FINESA_LOCAL_DIR: expected } }),
    expected,
  );
  assert.throws(
    () =>
      resolveLocalRuntime({
        env: { LOCALAPPDATA: localData, FINESA_LOCAL_DIR: join(localData, "missing") },
      }),
    /No existe/,
  );
});

test("rechaza instalaciones ambiguas para no seleccionar credenciales distintas", () => {
  const localData = join(fixtures, "ambiguous");
  makeConfig(join(localData, "FinesaInventario"));
  makeConfig(
    join(localData, "Packages", "OpenAI.Codex_fixture", "LocalCache", "Local", "FinesaInventario"),
  );
  assert.throws(
    () => resolveLocalRuntime({ env: { LOCALAPPDATA: localData }, platform: "win32" }),
    /varias configuraciones/,
  );
});

test("preparar reutiliza la ubicacion existente y solo admite una nueva si no existe ninguna", () => {
  const localData = join(fixtures, "prepare");
  assert.equal(
    resolveLocalRuntime({ env: { LOCALAPPDATA: localData }, allowMissing: true }),
    join(localData, "FinesaInventario"),
  );
  const expected = makeConfig(
    join(localData, "Packages", "OpenAI.Codex_fixture", "LocalCache", "Local", "FinesaInventario"),
  );
  assert.equal(
    resolveLocalRuntime({
      env: { LOCALAPPDATA: localData },
      platform: "win32",
      allowMissing: true,
    }),
    expected,
  );
});
