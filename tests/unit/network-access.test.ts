import { describe, expect, it } from "vitest";
import { restrictInternalNetwork } from "@/lib/network-access.server";

const corporate = "172.18.150.0/23";
function requestFrom(peer?: string, headers?: Record<string, string>) {
  return Object.assign(
    new Request("http://finesa.test/firmar/prueba", headers ? { headers } : {}),
    {
      runtime: { node: { req: { socket: { remoteAddress: peer } } } },
    },
  );
}

describe("acceso por red corporativa", () => {
  it.each([
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "172.18.150.100",
    "172.18.151.254",
    "::ffff:172.18.150.100",
    "::ffff:ac12:9664",
  ])("permite conexion directa autorizada: %s", (peer) => {
    expect(restrictInternalNetwork(requestFrom(peer), corporate)).toBeUndefined();
  });

  it.each([
    "172.18.149.255",
    "172.18.152.0",
    "10.0.0.25",
    "192.168.1.25",
    "203.0.113.25",
    "2001:db8::25",
    "desconocida",
    undefined,
  ])("rechaza redes no autorizadas aunque sean privadas: %s", (peer) => {
    expect(restrictInternalNetwork(requestFrom(peer), corporate)?.status).toBe(403);
  });

  it("ignora IPs falsificadas en cabeceras, contexto y propiedad ip", () => {
    const request = Object.assign(
      requestFrom("203.0.113.25", {
        "x-forwarded-for": "172.18.150.25",
        "x-real-ip": "127.0.0.1",
        "cf-connecting-ip": "172.18.150.25",
        forwarded: "for=172.18.150.25",
      }),
      { ip: "172.18.150.25", context: { clientAddress: "172.18.150.25" } },
    );
    expect(restrictInternalNetwork(request, corporate)?.status).toBe(403);
  });

  it("sin socket verificable rechaza incluso una IP declarada interna", () => {
    const request = Object.assign(new Request("http://finesa.test"), {
      ip: "127.0.0.1",
      context: { clientAddress: "127.0.0.1" },
    });
    expect(restrictInternalNetwork(request, corporate)?.status).toBe(403);
  });

  it("sin configuracion solo permite el equipo local", () => {
    expect(restrictInternalNetwork(requestFrom("127.0.0.1"), "")).toBeUndefined();
    expect(restrictInternalNetwork(requestFrom("172.18.150.25"), "")?.status).toBe(403);
  });

  it.each([
    "0.0.0.0/0",
    "::/0",
    "172.18.150.0/33",
    "172.18.150.0/no",
    "172.18.150.0/23/extra",
    "Any",
    "172.18.150.0/23,incorrecto",
  ])("una politica invalida falla cerrada: %s", (config) => {
    expect(restrictInternalNetwork(requestFrom("127.0.0.1"), config)?.status).toBe(403);
  });

  it("una VPN de prueba solo entra si se autoriza explicitamente su rango", () => {
    const request = requestFrom("10.99.8.20");
    expect(restrictInternalNetwork(request, corporate)?.status).toBe(403);
    expect(restrictInternalNetwork(request, `${corporate},10.99.8.0/24`)).toBeUndefined();
  });
});
