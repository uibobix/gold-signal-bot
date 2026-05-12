import { useMemo } from "react";

export function PriceChart({ candles }: { candles: Array<{ close: number; high: number; low: number }> }) {
  const { path, areaPath, min, max, last } = useMemo(() => {
    if (!candles.length) return { path: "", areaPath: "", min: 0, max: 0, last: 0 };
    const closes = candles.map(c => c.close);
    const min = Math.min(...candles.map(c => c.low));
    const max = Math.max(...candles.map(c => c.high));
    const w = 1000;
    const h = 280;
    const stepX = w / (closes.length - 1 || 1);
    const scaleY = (v: number) => h - ((v - min) / (max - min || 1)) * h;
    const points = closes.map((v, i) => `${i * stepX},${scaleY(v)}`);
    const path = "M" + points.join(" L");
    const areaPath = `${path} L${w},${h} L0,${h} Z`;
    return { path, areaPath, min, max, last: closes[closes.length - 1] };
  }, [candles]);

  return (
    <svg viewBox="0 0 1000 280" className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="goldFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.83 0.16 85)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="oklch(0.83 0.16 85)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1="0" x2="1000" y1={280 * p} y2={280 * p} stroke="oklch(0.28 0.005 285)" strokeDasharray="2 4" />
      ))}
      <path d={areaPath} fill="url(#goldFade)" />
      <path d={path} stroke="oklch(0.83 0.16 85)" strokeWidth="1.5" fill="none" />
      <text x="990" y="14" textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
        {max.toFixed(2)}
      </text>
      <text x="990" y="275" textAnchor="end" className="fill-muted-foreground" style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}>
        {min.toFixed(2)}
      </text>
      <text x="990" y={140} textAnchor="end" className="fill-foreground" style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600 }}>
        {last.toFixed(2)}
      </text>
    </svg>
  );
}
