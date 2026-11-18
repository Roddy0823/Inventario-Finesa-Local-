import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// Codex instalado como MSIX puede redirigir LocalAppData. Docker y las
// terminales externas necesitan el nombre fisico, no la ruta virtualizada.
export function resolveLocalRuntime({
  env = process.env,
  platform = process.platform,
  allowMissing = false,
} = {}) {
  const localData = env.LOCALAPPDATA || join(homedir(), ".local", "share");
  const defaultRoot = join(localData, "FinesaInventario");
  const explicit = env.FINESA_LOCAL_DIR?.trim();
  const configPath = (root) => join(root, "supabase", ".env");
  const physicalRoot = (root) => dirname(dirname(realpathSync.native(configPath(root))));

  if (explicit) {
    const root = resolve(explicit);
    if (existsSync(configPath(root))) return physicalRoot(root);
    if (allowMissing) return root;
    throw new Error(
      `No existe ${configPath(root)}. FINESA_LOCAL_DIR debe apuntar a la carpeta FinesaInventario, sin anadir supabase.`,
    );
  }

  const candidates = [defaultRoot];
  if (platform === "win32") {
    const packages = join(localData, "Packages");
    if (existsSync(packages)) {
      for (const entry of readdirSync(packages, { withFileTypes: true })) {
        if (entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name)) {
          candidates.push(join(packages, entry.name, "LocalCache", "Local", "FinesaInventario"));
        }
      }
    }
  }

  const existing = new Map();
  for (const root of candidates) {
    if (!existsSync(configPath(root))) continue;
    const physical = physicalRoot(root);
    existing.set(platform === "win32" ? physical.toLowerCase() : physical, physical);
  }
  if (existing.size === 1) return existing.values().next().value;
  if (existing.size > 1) {
    throw new Error(
      `Hay varias configuraciones locales. Define FINESA_LOCAL_DIR con la que deseas usar:\n${[...existing.values()].join("\n")}`,
    );
  }
  if (allowMissing) return defaultRoot;
  throw new Error(
    `No se encontro la configuracion local (${configPath(defaultRoot)}). Define FINESA_LOCAL_DIR con la ubicacion existente; no es necesario regenerar las claves.`,
  );
}
