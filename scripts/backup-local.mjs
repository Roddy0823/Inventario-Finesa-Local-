import { spawnSync } from "node:child_process";
import { cpSync, createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { resolveLocalRuntime } from "./local-runtime.mjs";
import { LOCAL_PROJECT, assertMatchingRuntime, resolveDockerExecutable } from "./local-docker.mjs";

// Respaldo físico consistente: exige que todos los servicios estén apagados.
// Incluye las claves originales; el destino predeterminado está fuera de OneDrive.
const docker = resolveDockerExecutable();
function run(args) {
  const result = spawnSync(docker, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(result.stderr?.trim() || `Docker terminó con código ${result.status}`);
  return result.stdout.trim();
}
async function checksum(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  const runtime = resolveLocalRuntime();
  const stack = join(runtime, "supabase");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = resolve(process.argv[2] || join(runtime, "backups", stamp));
  if (existsSync(destination))
    throw new Error("El destino del respaldo ya existe. Use una carpeta nueva.");
  const ids = run(["ps", "-aq", "--filter", `label=com.docker.compose.project=${LOCAL_PROJECT}`])
    .split(/\r?\n/)
    .filter(Boolean);
  if (!ids.length)
    throw new Error("No se encontraron los contenedores de la instalación existente.");
  const containers = JSON.parse(run(["inspect", ...ids]));
  if (containers.some((container) => container.State.Running))
    throw new Error(
      "Apague la aplicación y ejecute node scripts/local.mjs stop antes del respaldo.",
    );
  assertMatchingRuntime(
    stack,
    containers
      .map((container) => container.Config.Labels["com.docker.compose.project.working_dir"])
      .join("\n"),
  );
  const database = containers.find(
    (container) => container.Config.Labels["com.docker.compose.service"] === "db",
  );
  if (!database || database.State.ExitCode !== 0)
    throw new Error("PostgreSQL debe haberse detenido correctamente antes del respaldo físico.");
  const volumes = run([
    "volume",
    "ls",
    "--filter",
    `label=com.docker.compose.project=${LOCAL_PROJECT}`,
    "--format",
    "{{.Name}}",
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  for (const suffix of ["finesa-db", "finesa-storage", "db-config"]) {
    if (!volumes.includes(`${LOCAL_PROJECT}_${suffix}`))
      throw new Error(`Falta el volumen ${suffix}.`);
  }
  mkdirSync(destination, { recursive: true });
  const config = join(destination, "config");
  mkdirSync(config);
  for (const name of ["supabase", "version.json", "lan.json", "administrador-local.json"]) {
    const source = join(runtime, name);
    if (!existsSync(source)) continue;
    cpSync(source, join(config, name), {
      recursive: true,
      filter: (path) =>
        !/^(?:volumes[/\\]db[/\\]data|volumes[/\\]storage)(?:[/\\]|$)/.test(relative(stack, path)),
    });
  }
  const archives = [];
  for (const volume of volumes) {
    const archive = `${volume}.tar.gz`;
    run([
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      "0",
      "--entrypoint",
      "tar",
      "--mount",
      `type=volume,source=${volume},target=/source,readonly`,
      "--mount",
      `type=bind,source=${destination},target=/backup`,
      database.Image,
      "-czf",
      `/backup/${archive}`,
      "-C",
      "/source",
      ".",
    ]);
    // Leer por completo cada archivo detecta un tar/gzip truncado antes de continuar.
    run([
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "tar",
      "--mount",
      `type=bind,source=${destination},target=/backup,readonly`,
      database.Image,
      "-tzf",
      `/backup/${archive}`,
    ]);
    archives.push({ volume, archive, sha256: await checksum(join(destination, archive)) });
  }
  writeFileSync(
    join(destination, "manifest.json"),
    JSON.stringify(
      { createdAt: new Date().toISOString(), runtime, postgresImage: database.Image, archives },
      null,
      2,
    ),
  );
  console.log(`Respaldo verificado: ${destination}`);
  console.log(
    "Conserve juntos los archivos de volúmenes, config y manifest.json. Contienen las claves de la instalación.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
