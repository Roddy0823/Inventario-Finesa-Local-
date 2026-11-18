import { afterEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ThemeProvider, useTheme } from "@/lib/theme";

afterEach(() => vi.unstubAllGlobals());

function ThemeState() {
  const { theme, resolvedTheme } = useTheme();
  return createElement("span", null, `${theme}:${resolvedTheme}`);
}

it("el primer render conserva el mismo tema en servidor y navegador hasta hidratar", () => {
  const render = () =>
    renderToString(createElement(ThemeProvider, null, createElement(ThemeState)));
  const server = render();
  const readPreference = vi.fn(() => "light");
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: readPreference });
  vi.stubGlobal("document", { documentElement: { classList: { contains: () => false } } });
  expect(render()).toBe(server);
  expect(readPreference).not.toHaveBeenCalled();
});
