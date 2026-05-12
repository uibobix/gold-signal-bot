import { useState } from "react";

export function PositionSizer({ entry, stopLoss }: { entry: number; stopLoss: number }) {
  const [account, setAccount] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);
  const slDistance = Math.abs(entry - stopLoss);
  const riskUSD = account * (riskPct / 100);
  // For XAUUSD: 1 standard lot = 100 oz, $1 move = $100 P/L per lot
  const lots = slDistance > 0 ? riskUSD / (slDistance * 100) : 0;

  return (
    <div className="bg-surface border border-border p-5 animate-reveal" style={{ animationDelay: "150ms" }}>
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Position Sizer</h3>
      <div className="space-y-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Account ($)</span>
          <input
            type="number"
            value={account}
            onChange={e => setAccount(Math.max(0, +e.target.value))}
            className="mt-1 w-full bg-background border border-border px-2 py-1.5 text-sm font-mono focus:border-accent outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk per trade (%)</span>
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={e => setRiskPct(Math.max(0, Math.min(10, +e.target.value)))}
            className="mt-1 w-full bg-background border border-border px-2 py-1.5 text-sm font-mono focus:border-accent outline-none"
          />
        </label>
        <div className="pt-3 border-t border-border/50 space-y-2 font-mono">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Risk amount</span>
            <span className="text-danger">${riskUSD.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">SL distance</span>
            <span>${slDistance.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-base pt-1">
            <span className="text-muted-foreground text-xs uppercase tracking-wider mt-1">Lot size</span>
            <span className="text-accent font-bold">{lots.toFixed(2)}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed pt-2">
          Standard lot = 100 oz. Adjust to micro (0.01) if your broker requires.
        </p>
      </div>
    </div>
  );
}
