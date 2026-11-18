import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { attachSupabaseAuth } from "./integrations/supabase/auth-attacher";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

const internalNetworkMiddleware = createMiddleware().server(async ({ next }) => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { restrictInternalNetwork } = await import("./lib/network-access.server");
  const denied = restrictInternalNetwork(getRequest());
  return denied || next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [internalNetworkMiddleware, csrfMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
