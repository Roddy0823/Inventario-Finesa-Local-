import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveLocalRuntime } from "./local-runtime.mjs";

// Envoy 1.39 usa la URL como realm. Un realm fijo permite que el navegador
// reutilice Basic Auth al cargar los scripts y las APIs de Studio.
// Solo cambia el desafío HTTP; la validación de usuario/contraseña se conserva.
const runtime = resolveLocalRuntime();
const path = join(runtime, "supabase", "volumes", "api", "envoy", "lds.template.yaml");
const source = readFileSync(path, "utf8");
const marker = "# Finesa: stable Studio Basic Auth realm";
const anchor = "                - name: envoy.filters.http.basic_auth";
if (!source.includes(marker)) {
  if (!source.includes(anchor))
    throw new Error(
      "No se encontró el filtro Basic Auth esperado; no se modificó la configuración.",
    );
  const filter = `                ${marker}
                - name: envoy.filters.http.lua
                  typed_config:
                    '@type': type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
                    inline_code: |
                      function envoy_on_response(handle)
                        local challenge = handle:headers():get("www-authenticate")
                        if challenge and string.sub(string.lower(challenge), 1, 6) == "basic " then
                          handle:headers():replace("www-authenticate", 'Basic realm="Finesa Studio"')
                        end
                      end

`;
  if (!existsSync(`${path}.before-finesa-realm`)) copyFileSync(path, `${path}.before-finesa-realm`);
  writeFileSync(path, source.replace(anchor, filter + anchor));
}
console.log("Realm de Studio configurado. Reiniciar únicamente api-gw para aplicar.");
