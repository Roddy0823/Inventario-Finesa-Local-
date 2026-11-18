import { afterEach, expect, it, vi } from "vitest";
import { detectarIpNavegador } from "@/lib/detectarIp";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("no consulta servicios externos de IP en el navegador local", async () => {
  vi.stubEnv("VITE_LOCAL_ONLY", "true");
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  expect(await detectarIpNavegador()).toBeUndefined();
  expect(fetchSpy).not.toHaveBeenCalled();
});
