import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeInvalidator } from "@/lib/realtime-invalidation";

describe("actualización agrupada de Realtime", () => {
  let qc: QueryClient;
  beforeEach(() => {
    vi.useFakeTimers();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  });
  afterEach(() => {
    qc.clear();
    vi.useRealTimers();
  });

  it("1000 cambios de filas generan una sola lectura por consulta activa", async () => {
    const read = vi.fn().mockResolvedValue(1);
    const observer = new QueryObserver(qc, {
      queryKey: ["equipos", "pagina"],
      queryFn: read,
      initialData: 0,
    });
    const stop = observer.subscribe(() => {});
    const batch = createRealtimeInvalidator(qc);
    for (let i = 0; i < 1000; i++) batch.add("equipos");
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(1);
    expect(observer.getCurrentResult().data).toBe(1);
    stop();
    batch.dispose();
  });

  it("los cambios durante una consulta lenta generan una lectura final sin cancelarla continuamente", async () => {
    let finish!: (value: number) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(2);
    const observer = new QueryObserver(qc, { queryKey: ["actas"], queryFn: read, initialData: 0 });
    const stop = observer.subscribe(() => {});
    const batch = createRealtimeInvalidator(qc);
    batch.add("actas");
    await vi.advanceTimersByTimeAsync(300);
    for (let i = 0; i < 5; i++) {
      batch.add("actas");
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(read).toHaveBeenCalledTimes(1);
    finish(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe(2);
    stop();
    batch.dispose();
  });

  it("marca cachés inactivos sin descargarlos ni tocar módulos ajenos", async () => {
    qc.setQueryData(["equipos", "pagina"], []);
    qc.setQueryData(["catalogos"], []);
    const batch = createRealtimeInvalidator(qc);
    batch.add("equipos");
    await vi.advanceTimersByTimeAsync(300);
    expect(qc.getQueryState(["equipos", "pagina"])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(["catalogos"])?.isInvalidated).toBe(false);
    batch.dispose();
  });

  it("desmontar cancela actualizaciones pendientes de la cuenta anterior", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const batch = createRealtimeInvalidator(qc);
    batch.add("equipos");
    batch.dispose();
    batch.add("actas");
    await vi.advanceTimersByTimeAsync(1000);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
