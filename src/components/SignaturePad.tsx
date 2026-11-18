import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser } from "lucide-react";

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const hasInk = useRef(false);
  const pixelRatio = useRef(1);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current!;
    hasInk.current = false;
    drawing.current = false;
    last.current = null;
    setEmpty(true);
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    pixelRatio.current = ratio;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    c.width = w * ratio;
    c.height = h * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0B2545";
    onChange(null);
    return () => onChange(null);
  }, [onChange]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const c = ref.current!;
    return {
      x: ((e.clientX - r.left) * c.width) / r.width / pixelRatio.current,
      y: ((e.clientY - r.top) * c.height) / r.height / pixelRatio.current,
    };
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = pos(e);
    if (!last.current || Math.hypot(p.x - last.current.x, p.y - last.current.y) < 0.5) return;
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    hasInk.current = true;
    if (empty) setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(hasInk.current ? ref.current!.toDataURL("image/png") : null);
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    hasInk.current = false;
    drawing.current = false;
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-input bg-white text-slate-900 shadow-inner">
        <canvas
          ref={ref}
          className="h-48 w-full touch-none cursor-crosshair sm:h-56"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerLeave={up}
          onPointerCancel={up}
          aria-label="Área de firma"
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Firme aquí con el dedo o el mouse
          </span>
        )}
        <div className="pointer-events-none absolute bottom-10 left-6 right-6 border-b border-slate-200" />
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={clear}>
        <Eraser className="mr-1 h-4 w-4" /> Borrar firma
      </Button>
    </div>
  );
}
