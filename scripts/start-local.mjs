import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveLocalRuntime } from "./local-runtime.mjs";
import { resolveDockerExecutable } from "./local-docker.mjs";
import { canReuseLocalApp } from "./local-readiness.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const appUrl = "http://127.0.0.1:8080";
let activeChild;
let interrupted = false;

function interrupt(signal) {
  if (interrupted) return;
  interrupted = true;
  process.exitCode = signal === "SIGINT" ? 130 : 143;
  if (!activeChild?.pid || activeChild.exitCode !== null || activeChild.signalCode !== null) return;
  if (process.platform === "win32") {
    // local.mjs starts the server as a child; close that whole owned tree.
    execFile(
      "taskkill",
      ["/PID", String(activeChild.pid), "/T", "/F"],
      { windowsHide: true },
      () => {},
    );
  } else {
    try {
      process.kill(-activeChild.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  }
}

process.on("SIGINT", () => interrupt("SIGINT"));
process.on("SIGTERM", () => interrupt("SIGTERM"));

async function isPortOpen() {
  return new Promise((resolvePort, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: 8080 });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolvePort(false);
      else reject(new Error(`No se pudo comprobar el puerto 8080: ${error.message}`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("La comprobacion del puerto 8080 no respondio."));
    });
  });
}

async function findRunningApp() {
  if (!(await isPortOpen())) return false;
  try {
    const response = await fetch(appUrl, { signal: AbortSignal.timeout(5000) });
    const html = await response.text();
    if (response.ok && /<title\b[^>]*>[^<]*\bfinesa\b[^<]*<\/title>/i.test(html)) return true;
  } catch {
    // A listening port without the expected page must not get a second server.
  }
  throw new Error(
    "El puerto 8080 esta ocupado, pero no responde la pagina de Finesa. Cierre el servicio que lo usa antes de iniciar.",
  );
}

async function checkDocker(env) {
  const docker = resolveDockerExecutable();
  try {
    await execFileAsync(docker, ["info", "--format", "{{.ServerVersion}}"], {
      cwd: root,
      env,
      timeout: 15000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail = error.killed
      ? "Docker no respondio en 15 segundos."
      : error.stderr?.trim() || error.message;
    throw new Error(
      `Docker no esta disponible.\n${detail}\nAbra Docker Desktop y espere a que este listo. Si ya esta abierto, reinicie Docker Desktop y vuelva a ejecutar este archivo.`,
    );
  }
}

async function runLocal(action, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts", "local.mjs"), action], {
      cwd: root,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    activeChild = child;
    child.once("error", (error) => {
      activeChild = undefined;
      reject(error);
    });
    child.once("close", (code, signal) => {
      activeChild = undefined;
      if (interrupted) {
        resolveRun(false);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `No se completo '${action}' (${signal || `codigo ${code}`}). Revise el mensaje anterior.`,
          ),
        );
        return;
      }
      resolveRun(true);
    });
  });
}

try {
  if (args.some((arg) => arg !== "--check")) throw new Error("Uso: Iniciar-Finesa.cmd [--check]");
  const runtime = resolveLocalRuntime();
  if (!existsSync(join(runtime, "supabase", ".env")))
    throw new Error(`No se encontro la configuracion: ${join(runtime, "supabase", ".env")}`);
  if (!existsSync(join(runtime, "supabase", "docker-compose.yml")))
    throw new Error("Falta docker-compose.yml en la configuracion local de Supabase.");
  if (!existsSync(join(root, ".output", "server", "index.mjs")))
    throw new Error(
      "No se encontro la aplicacion compilada (.output/server/index.mjs). Es necesario compilarla antes de iniciar.",
    );
  const env = { ...process.env, FINESA_LOCAL_DIR: runtime };
  console.log(`Configuracion local: ${runtime}`);
  const alreadyRunning = await findRunningApp();
  if (await canReuseLocalApp({ alreadyRunning, checkOnly, runtime })) {
    console.log(
      "Finesa ya esta iniciado; autenticacion, datos, archivos y sincronizacion listos. Abra http://localhost:8080",
    );
  } else {
    console.log("Comprobando Docker Desktop...");
    await checkDocker(env);
    if (!interrupted && checkOnly) {
      console.log(
        `Comprobacion correcta. ${alreadyRunning ? "Finesa ya responde en http://localhost:8080." : "El puerto 8080 esta disponible."}`,
      );
    } else if (!interrupted) {
      console.log("Iniciando servicios y comprobando su disponibilidad...");
      if ((await runLocal("up", env)) && !interrupted) {
        if (await findRunningApp()) {
          console.log("Finesa ya esta iniciado. Abra http://localhost:8080");
        } else {
          console.log("Iniciando la aplicacion en http://localhost:8080");
          console.log("Mantenga esta ventana abierta. Presione Ctrl+C para cerrar la aplicacion.");
          await runLocal("serve", env);
        }
      }
    }
  }
} catch (error) {
  if (!interrupted) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
