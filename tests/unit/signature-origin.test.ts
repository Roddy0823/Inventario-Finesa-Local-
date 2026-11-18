import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signatureOrigin } from "@/lib/signature-origin.server";

vi.mock("node:os", () => ({
  networkInterfaces: () => ({
    loopback: [{ address: "127.0.0.1", internal: true }],
    wifi: [{ address: "172.18.150.127", internal: false }],
  }),
}));

beforeEach(() => {
  vi.stubEnv("LOCAL_ONLY", "true");
  vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", "http://172.18.150.127:8080/");
});
afterEach(() => vi.unstubAllEnvs());

describe("dirección compartible de firma", () => {
  it("usa la dirección vigente y elimina la barra final", () => {
    expect(signatureOrigin()).toBe("http://172.18.150.127:8080");
  });
  it("detecta una IP anterior asignada por DHCP", () => {
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", "http://172.18.150.100:8080");
    expect(signatureOrigin).toThrow("ya no pertenece a este equipo");
  });
  it("no ofrece localhost como respaldo en una instalación local sin configurar", () => {
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", "");
    expect(signatureOrigin).toThrow("no está configurada");
  });
  it.each(["localhost", "127.0.0.1", "[::1]"])("rechaza el destino local %s", (host) => {
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", `http://${host}:8080`);
    expect(signatureOrigin).toThrow("no localhost");
  });
  it("admite un nombre DNS configurado que no depende de la IP DHCP", () => {
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", "https://inventario.finesa.test");
    expect(signatureOrigin()).toBe("https://inventario.finesa.test");
  });
  it.each([
    "incorrecto",
    "ftp://172.18.150.127",
    "http://172.18.150.127/firmar",
    "http://user:pass@172.18.150.127",
  ])("rechaza un origen inválido: %s", (origin) => {
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", origin);
    expect(signatureOrigin).toThrow();
  });
  it("conserva el origen de la página para despliegues web sin origen explícito", () => {
    vi.stubEnv("LOCAL_ONLY", "false");
    vi.stubEnv("PUBLIC_SIGNATURE_ORIGIN", "");
    expect(signatureOrigin()).toBeNull();
  });
});
