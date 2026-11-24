import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  const checkBuild = mode === "check";
  if (command === "build" && !checkBuild) {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
      throw new Error(
        "Falta la configuración pública de Supabase para compilar la aplicación. " +
          "En la instalación local ejecute: node scripts/local.mjs build. " +
          "Para validar el código sin configurar una instalación use: bun run build:check.",
      );
    }
  }
  return {
    server: {
      host: "127.0.0.1",
      port: 8080,
    },
    resolve: {
      tsconfigPaths: true,
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    plugins: [
      tailwindcss(),
      tanstackStart({
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
      }),
      // Evita copias simultáneas de versiones duplicadas de tslib en Windows.
      ...(command === "build"
        ? [
            nitro({
              noExternals: ["tslib"],
              ...(checkBuild
                ? {
                    buildDir: ".cache/check-build-tmp",
                    output: {
                      dir: ".cache/check-build",
                      serverDir: ".cache/check-build/server",
                      publicDir: ".cache/check-build/public",
                    },
                  }
                : {}),
            }),
          ]
        : []),
      viteReact(),
    ],
  };
});
