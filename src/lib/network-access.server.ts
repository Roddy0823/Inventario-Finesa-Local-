import { BlockList, isIP } from "node:net";

type DirectRequest = Request & {
  runtime?: { node?: { req?: { socket?: { remoteAddress?: string } } } };
};

let cachedConfig: string | undefined;
let cachedNetworks: BlockList | undefined;

function allowedNetworks(config: string): BlockList {
  if (config === cachedConfig && cachedNetworks) return cachedNetworks;
  const networks = new BlockList();
  networks.addSubnet("127.0.0.0", 8, "ipv4");
  networks.addAddress("::1", "ipv6");

  for (const cidr of config
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const parts = cidr.split("/");
    const address = parts[0]!;
    const family = isIP(address);
    const prefix = Number(parts[1]);
    if (
      parts.length !== 2 ||
      !family ||
      !/^\d+$/.test(parts[1]!) ||
      !Number.isInteger(prefix) ||
      prefix < 1 ||
      prefix > (family === 4 ? 32 : 128)
    ) {
      throw new Error("INTERNAL_NETWORK_CIDRS contiene una red no valida.");
    }
    networks.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
  }
  cachedConfig = config;
  cachedNetworks = networks;
  return networks;
}

/** Control por conexion TCP directa. Nunca autorizar a partir de cabeceras del cliente. */
export function restrictInternalNetwork(
  request: Request,
  config = process.env["INTERNAL_NETWORK_CIDRS"] || "",
): Response | undefined {
  const peer = (request as DirectRequest).runtime?.node?.req?.socket?.remoteAddress;
  const family = peer ? isIP(peer) : 0;
  try {
    if (family && allowedNetworks(config).check(peer!, family === 4 ? "ipv4" : "ipv6")) return;
  } catch {
    // Una configuracion invalida nunca permite el acceso por defecto.
  }
  return new Response(
    "Acceso disponible unicamente desde la red corporativa o la VPN autorizada.",
    {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}
