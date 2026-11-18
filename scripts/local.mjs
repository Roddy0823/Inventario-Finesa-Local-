import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveLocalRuntime } from "./local-runtime.mjs";
import { migrationChecksums } from "./migration-checksum.mjs";
import {
  LOCAL_PROJECT,
  resolveDockerExecutable,
  assertNoExistingInstallation,
  assertMatchingRuntime,
} from "./local-docker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const action = process.argv[2];
let runtime;
try {
  runtime = resolveLocalRuntime({ allowMissing: action === "prepare" });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
process.env.FINESA_LOCAL_DIR = runtime;
const stack = join(runtime, "supabase");
const revision = "bc27d2661edd09a5d0b8d76ce33da6d4071a756e";
const dockerExecutable = resolveDockerExecutable();
const composeArgs = [
  "compose",
  "--project-name",
  LOCAL_PROJECT,
  "--project-directory",
  stack,
  "--env-file",
  join(stack, ".env"),
  "-f",
  join(stack, "docker-compose.yml"),
  "-f",
  join(root, "deploy", "local.override.yml"),
];

function run(command, args, options = {}) {
  if (command === "docker") command = dockerExecutable;
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} terminó con código ${result.status}`);
  return result.stdout?.toString().trim();
}
function docker(...args) {
  return run("docker", [...composeArgs, ...args]);
}
function jwt(role, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iss: "supabase", iat: now, exp: now + 10 * 365 * 86400 })}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
function envFile(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z_][A-Z_0-9]*=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^"(.*)"$/, "$1")];
      }),
  );
}
function appEnv() {
  const config = envFile(join(stack, ".env"));
  const lanPath = join(runtime, "lan.json");
  const lan = existsSync(lanPath) ? JSON.parse(readFileSync(lanPath, "utf8")) : {};
  const allowedNetworks = lan.allowedNetworks ?? [];
  if (
    !Array.isArray(allowedNetworks) ||
    allowedNetworks.some((value) => typeof value !== "string" || !value.trim())
  )
    throw new Error("lan.json: allowedNetworks debe ser una lista de redes CIDR autorizadas.");
  if (lan.signatureOrigin && !allowedNetworks.length)
    throw new Error(
      "lan.json: configure allowedNetworks con las redes corporativas/VPN autorizadas antes de habilitar firmas en red.",
    );
  return {
    ...process.env,
    LOCAL_ONLY: "true",
    VITE_LOCAL_ONLY: "true",
    PUBLIC_SIGNATURE_ORIGIN: lan.signatureOrigin || "",
    INTERNAL_NETWORK_CIDRS: allowedNetworks.join(","),
    SUPABASE_URL: config.SUPABASE_PUBLIC_URL,
    VITE_SUPABASE_URL: config.SUPABASE_PUBLIC_URL,
    SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY,
    HOST: lan.signatureOrigin ? "0.0.0.0" : "127.0.0.1",
    PORT: "8080",
    NITRO_HOST: lan.signatureOrigin ? "0.0.0.0" : "127.0.0.1",
    NITRO_PORT: "8080",
  };
}

try {
  if (action === "prepare") {
    const source = resolve(process.argv[3] || join(root, "..", "supabase-runtime"));
    const actual = run("git", ["-C", source, "rev-parse", "HEAD"], { stdio: "pipe" });
    if (actual !== revision)
      throw new Error(`Se requiere Supabase self-hosted/v0.8.3 (${revision}).`);
    if (existsSync(join(stack, ".env")))
      throw new Error(`El entorno ya existe en ${stack}; no se reemplazan sus claves.`);
    // La instalación local usa nombres fijos: una nueva carpeta nunca debe
    // generar secretos para volúmenes que pertenecen a una instalación previa.
    const oldVolumes = run(
      "docker",
      [
        "volume",
        "ls",
        "--filter",
        `label=com.docker.compose.project=${LOCAL_PROJECT}`,
        "--format",
        "{{.Name}}",
      ],
      { stdio: "pipe" },
    );
    const oldContainers = run(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `label=com.docker.compose.project=${LOCAL_PROJECT}`,
        "--format",
        "{{.Names}}",
      ],
      { stdio: "pipe" },
    );
    assertNoExistingInstallation(oldVolumes, oldContainers);
    mkdirSync(stack, { recursive: true });
    cpSync(join(source, "docker"), stack, {
      recursive: true,
      filter: (path) => !/[/\\](data|storage)$/.test(path),
    });
    const secret = randomBytes(32).toString("hex");
    const config = {
      POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
      JWT_SECRET: secret,
      ANON_KEY: jwt("anon", secret),
      SERVICE_ROLE_KEY: jwt("service_role", secret),
      DASHBOARD_USERNAME: "finesa",
      DASHBOARD_PASSWORD: `Finesa${randomBytes(24).toString("hex")}`,
      SECRET_KEY_BASE: randomBytes(48).toString("hex"),
      REALTIME_DB_ENC_KEY: randomBytes(8).toString("hex"),
      VAULT_ENC_KEY: randomBytes(16).toString("hex"),
      PG_META_CRYPTO_KEY: randomBytes(24).toString("hex"),
      LOGFLARE_PUBLIC_ACCESS_TOKEN: randomBytes(24).toString("hex"),
      LOGFLARE_PRIVATE_ACCESS_TOKEN: randomBytes(24).toString("hex"),
      S3_PROTOCOL_ACCESS_KEY_ID: randomBytes(16).toString("hex"),
      S3_PROTOCOL_ACCESS_KEY_SECRET: randomBytes(32).toString("hex"),
      MINIO_ROOT_PASSWORD: randomBytes(24).toString("hex"),
      OPENAI_API_KEY: "",
      SUPABASE_PUBLIC_URL: "http://localhost:8000",
      API_EXTERNAL_URL: "http://localhost:8000/auth/v1",
      SITE_URL: "http://localhost:8080",
      ADDITIONAL_REDIRECT_URLS: "http://localhost:8080/restablecer",
      DISABLE_SIGNUP: "true",
      ENABLE_PHONE_SIGNUP: "false",
      ENABLE_PHONE_AUTOCONFIRM: "false",
      SMTP_HOST: "mail",
      SMTP_PORT: "1025",
      SMTP_USER: "",
      SMTP_PASS: "",
      SMTP_ADMIN_EMAIL: "inventario@finesa.local",
      SMTP_SENDER_NAME: "Finesa Inventario",
      STUDIO_DEFAULT_ORGANIZATION: "Finesa",
      STUDIO_DEFAULT_PROJECT: "Inventario local",
      POOLER_TENANT_ID: "finesa-local",
    };
    let template = readFileSync(join(stack, ".env.example"), "utf8");
    for (const [key, value] of Object.entries(config))
      template = template.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    writeFileSync(join(stack, ".env"), template, { mode: 0o600 });
    writeFileSync(
      join(runtime, "version.json"),
      JSON.stringify({ supabase: revision, tag: "self-hosted/v0.8.3" }, null, 2),
    );
    run(process.execPath, ["scripts/fix-studio-auth.mjs"]);
    console.log(
      `Configuración creada en ${runtime}. Las claves no se imprimen ni se guardan en el repositorio.`,
    );
  } else if (action === "up") {
    const containerIds = run(
      "docker",
      ["ps", "-aq", "--filter", `label=com.docker.compose.project=${LOCAL_PROJECT}`],
      { stdio: "pipe" },
    )
      .split(/\r?\n/)
      .filter(Boolean);
    if (containerIds.length) {
      const originalStacks = run(
        "docker",
        [
          "inspect",
          "--format",
          '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}',
          ...containerIds,
        ],
        { stdio: "pipe" },
      );
      assertMatchingRuntime(stack, originalStacks);
    }
    docker("up", "-d", "--wait", "--wait-timeout", "240");
  } else if (action === "migrate") {
    // Solo aplicar después de que Auth y Storage terminen sus propias migraciones.
    const { readdirSync } = await import("node:fs");
    const migrations = readdirSync(join(root, "supabase", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    let sql =
      "CREATE SCHEMA IF NOT EXISTS finesa_local; REVOKE ALL ON SCHEMA finesa_local FROM PUBLIC;\nCREATE TABLE IF NOT EXISTS finesa_local.migrations (name text PRIMARY KEY, checksum text NOT NULL);\n";
    for (const name of migrations) {
      const source = readFileSync(join(root, "supabase", "migrations", name), "utf8");
      const hashes = migrationChecksums(source);
      const accepted = hashes.accepted.map((hash) => `'${hash}'`).join(",");
      sql += `SELECT EXISTS(SELECT 1 FROM finesa_local.migrations WHERE name='${name}') AS applied \\gset\n\\if :applied\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM finesa_local.migrations WHERE name='${name}' AND checksum IN (${accepted})) THEN RAISE EXCEPTION 'Migración aplicada modificada: ${name}'; END IF; END $$;\n\\else\nBEGIN;\n${source}\nINSERT INTO finesa_local.migrations VALUES ('${name}','${hashes.canonical}');\nCOMMIT;\n\\endif\n`;
    }
    sql +=
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $$;\n";
    for (const table of ["actas", "equipos"])
      sql += `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='${table}') THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.${table}; END IF; END $$;\n`;
    sql += "NOTIFY pgrst, 'reload schema';\n";
    run(
      "docker",
      [
        ...composeArgs,
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: sql, stdio: ["pipe", "inherit", "inherit"] },
    );
  } else if (action === "admin") {
    const { createClient } = await import("@supabase/supabase-js");
    const config = appEnv();
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const credentialsPath = join(runtime, "administrador-local.json");
    let credentials;
    if (existsSync(credentialsPath)) {
      credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
    } else {
      const { data, error } = await client.auth.admin.listUsers();
      if (error) throw error;
      if (data.users.length)
        throw new Error(
          "Ya hay usuarios: no se crea ni reemplaza un administrador automáticamente.",
        );
      credentials = {
        email: "admin@finesa.local",
        password: `Fi!${randomBytes(18).toString("base64url")}7a`,
        url: "http://localhost:8080",
      };
      writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    }
    const { data: existing, error: listError } = await client.auth.admin.listUsers();
    if (listError) throw listError;
    let user = existing.users.find((user) => user.email === credentials.email);
    if (!user) {
      const { data, error } = await client.auth.admin.createUser({
        email: credentials.email,
        password: credentials.password,
        email_confirm: true,
        user_metadata: { nombre: "Administrador local" },
      });
      if (error) throw error;
      user = data.user;
    }
    if (!/^[a-f0-9-]{36}$/i.test(user.id)) throw new Error("Identificador de usuario inválido.");
    const sql = `INSERT INTO public.user_roles (user_id, role, owner_id) VALUES ('${user.id}', 'admin', '${user.id}') ON CONFLICT (user_id, role) DO NOTHING;`;
    run(
      "docker",
      [
        ...composeArgs,
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: sql, stdio: ["pipe", "inherit", "inherit"] },
    );
    const login = await client.auth.signInWithPassword(credentials);
    if (login.error) throw login.error;
    await client.auth.signOut();
    console.log(`Administrador verificado. Credenciales guardadas en ${credentialsPath}`);
  } else if (action === "verify") {
    const { createClient } = await import("@supabase/supabase-js");
    const config = appEnv();
    const credentials = JSON.parse(readFileSync(join(runtime, "administrador-local.json"), "utf8"));
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const client = createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY, options);
    const admin = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, options);
    const login = await client.auth.signInWithPassword(credentials);
    if (login.error) throw login.error;
    try {
      for (const table of [
        "profiles",
        "user_roles",
        "equipos",
        "empleados",
        "actas",
        "catalogo_items",
      ]) {
        const result = await client.from(table).select("*").limit(1);
        if (result.error) throw new Error(`${table}: ${result.error.message}`);
        console.log(`Auth y lectura con RLS: ${table} OK`);
      }
      const buckets = await admin.storage.listBuckets();
      if (buckets.error) throw buckets.error;
      for (const name of ["actas", "facturas", "firmas"]) {
        if (!buckets.data.some((bucket) => bucket.id === name && !bucket.public))
          throw new Error(`Bucket privado ausente: ${name}`);
      }
      const path = `_verificacion/${randomBytes(8).toString("hex")}.txt`;
      const content = "Verificación local Finesa";
      const upload = await admin.storage
        .from("facturas")
        .upload(path, content, { contentType: "text/plain" });
      if (upload.error) throw upload.error;
      try {
        const signed = await admin.storage.from("facturas").createSignedUrl(path, 60);
        if (signed.error) throw signed.error;
        const response = await fetch(signed.data.signedUrl);
        if (!response.ok || (await response.text()) !== content)
          throw new Error("No coincide el archivo descargado de Storage.");
        console.log("Storage: carga, enlace firmado y descarga OK");
      } finally {
        const cleanup = await admin.storage.from("facturas").remove([path]);
        if (cleanup.error) throw cleanup.error;
      }
      const page = await fetch("http://localhost:8080");
      if (!page.ok) throw new Error(`Aplicación HTTP ${page.status}`);
      console.log("Aplicación: HTTP 200 OK");
    } finally {
      await client.auth.signOut();
    }
  } else if (action === "build") {
    run("bun", ["run", "build"], { env: appEnv() });
  } else if (action === "serve") {
    run(process.execPath, [".output/server/index.mjs"], {
      env: { ...appEnv(), NODE_ENV: "production" },
    });
  } else if (action === "stop") {
    docker("stop");
  } else if (action === "status") {
    docker("ps");
  } else {
    console.log(
      "node scripts/local.mjs prepare [ruta-supabase-runtime] | up | migrate | admin | verify | build | serve | stop | status",
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
