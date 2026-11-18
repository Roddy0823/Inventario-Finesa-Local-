import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const LOCAL_PROJECT = "finesa-local";

export function resolveDockerExecutable({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (platform !== "win32") return "docker";
  const installed = join(
    env.ProgramFiles || "C:\\Program Files",
    "Docker",
    "Docker",
    "resources",
    "bin",
    "docker.exe",
  );
  return exists(installed) ? installed : "docker";
}

export function assertNoExistingInstallation(volumeNames, containerNames) {
  if (volumeNames.trim() || containerNames.trim()) {
    throw new Error(
      "Ya existen datos o contenedores de Finesa. Restaure la configuración y sus claves originales; no se generarán credenciales nuevas para esos datos. FINESA_LOCAL_DIR no crea una segunda instalación.",
    );
  }
}

export function assertMatchingRuntime(expectedStack, containerStacks, platform = process.platform) {
  const normalize = (value) => {
    // Los contenedores creados desde una app MSIX pueden conservar la ruta
    // virtual. Comparar el .env físico acepta ese alias, nunca otras claves.
    const config = join(value, ".env");
    const physical = existsSync(config) ? dirname(realpathSync.native(config)) : value;
    const path = resolve(physical).replaceAll("\\", "/").replace(/\/$/, "");
    return platform === "win32" ? path.toLowerCase() : path;
  };
  for (const stack of containerStacks
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (normalize(stack) !== normalize(expectedStack)) {
      throw new Error(
        "Los contenedores de Finesa pertenecen a otra carpeta de configuración. Use FINESA_LOCAL_DIR con la instalación original o restaure el respaldo completo antes de iniciar.",
      );
    }
  }
}
