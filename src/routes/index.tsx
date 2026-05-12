import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSignal, type SignalResult } from "@/lib/signal.functions";
import { PriceChart } from "@/components/PriceChart";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Aureum Terminal — XAUUSD Live Signals" },
      { name: "description", content: "Live XAUUSD (gold/USD) trading signals with entry, stop loss, take profit and AI confidence — terminal-grade dashboard." },
    ],
  }),
});

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Dashboard() {
  const fetchSignal = useServerFn(getSignal);
  const { data, isLoading, refetch, isFetching } = useQuery<SignalResult>({
    queryKey: ["xauusd-signal"],
    queryFn: () => fetchSignal(),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground font-mono text-xs uppercase tracking-widest">
        <span className="animate-pulse-slow">Loading market feed…</span>
      </div>
    );
  }

  if (!data.ok) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="border border-danger/30 bg-danger/5 p-6 max-w-md">
          <p className="text-[10px] font-bold uppercase tracking-widest text-danger mb-2">Feed Error</p>
          <p className="text-sm text-foreground">{data.error}</p>
        </div>
      </div>
    );
  }

  const { price, changeAbs, changePct, high, low, candles, indicators, signal, history, winRate, fetchedAt } = data;
  const up = changeAbs >= 0;
  const sigColor = signal.type === "BUY" ? "text-success" : signal.type === "SELL" ? "text-danger" : "text-muted-foreground";
  const sigBg = signal.type === "BUY" ? "bg-success/10 border-success/30 text-success" : signal.type === "SELL" ? "bg-danger/10 border-danger/30 text-danger" : "bg-muted/20 border-border text-muted-foreground";
  const sigBar = signal.type === "BUY" ? "bg-success" : signal.type === "SELL" ? "bg-danger" : "bg-muted-foreground";

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-accent/30 p-4 md:p-6">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4 border-b border-border pb-6">
        <div className="flex items-center gap-4">
          <div className="size-10 bg-accent grid place-items-center rounded-sm">
            <div className="size-4 bg-background rotate-45" />
          </div>
          <div>
            <h1 className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">Aureum.Terminal</h1>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-bold tracking-tight">XAUUSD</span>
              <span className="text-xs font-mono text-muted-foreground">GOLD/USD</span>
            </div>
          </div>
        </div>

        <div className="flex gap-8 items-center">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Live Spot Price</p>
            <div className="flex items-baseline gap-2 justify-end">
              <span className={`text-3xl font-mono font-bold ${up ? "text-success" : "text-danger"} animate-pulse-slow`}>{fmt(price)}</span>
              <span className={`text-sm font-mono ${up ? "text-success" : "text-danger"}`}>
                {up ? "+" : ""}{fmt(changeAbs)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <span className="text-[10px] text-muted-foreground uppercase">24h High</span>
            <span className="text-[10px] font-mono">{fmt(high)}</span>
            <span className="text-[10px] text-muted-foreground uppercase">24h Low</span>
            <span className="text-[10px] font-mono">{fmt(low)}</span>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[10px] font-mono uppercase tracking-widest border border-border px-3 py-2 hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
          >
            {isFetching ? "Syncing" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div className="bg-card border border-border p-5 animate-reveal">
            <div className="flex justify-between items-center mb-6">
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${sigBg}`}>Active Signal</span>
              <span className="text-xs font-mono text-muted-foreground">{signal.id}</span>
            </div>
            <div className="mb-6">
              <h2 className={`text-4xl font-mono font-bold mb-1 ${sigColor}`}>{signal.type}</h2>
              <p className="text-sm text-muted-foreground">Confidence: <span className="text-foreground font-mono">{signal.confidence}%</span></p>
              <div className="w-full h-1 bg-secondary mt-2">
                <div className={`h-full ${sigBar}`} style={{ width: `${signal.confidence}%` }} />
              </div>
            </div>
            <div className="space-y-4 font-mono">
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-xs text-muted-foreground">ENTRY</span>
                <span className="text-sm font-bold">{fmt(signal.entry)}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2 text-danger">
                <span className="text-xs opacity-70">STOP LOSS</span>
                <span className="text-sm font-bold">{fmt(signal.stopLoss)}</span>
              </div>
              <div className="flex justify-between border-b border-border/50 pb-2 text-success">
                <span className="text-xs opacity-70">TAKE PROFIT</span>
                <span className="text-sm font-bold">{fmt(signal.takeProfit)}</span>
              </div>
            </div>
            <p className="mt-5 text-[11px] text-muted-foreground leading-relaxed">{signal.rationale}</p>
          </div>

          <div className="bg-surface border border-border p-5 animate-reveal" style={{ animationDelay: "100ms" }}>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Technical Readout</h3>
            <div className="space-y-3">
              <Row label="RSI (14)" value={`${indicators.rsi} (${indicators.rsiLabel})`} tone={indicators.rsi > 70 ? "danger" : indicators.rsi < 30 ? "success" : "muted"} />
              <Row label="MACD" value={indicators.macdLabel} tone={indicators.macd > indicators.macdSignal ? "success" : "danger"} />
              <Row label="EMA 50" value={fmt(indicators.ema50)} tone="muted" />
              <Row label="EMA 200" value={fmt(indicators.ema200)} tone="muted" />
            </div>
          </div>
        </aside>

        <div className="col-span-12 lg:col-span-9 space-y-6">
          <div className="animate-reveal" style={{ animationDelay: "150ms" }}>
            <div className="w-full bg-card border border-border flex flex-col">
              <div className="border-b border-border p-3 flex justify-between items-center">
                <div className="flex gap-4 text-[10px] font-mono uppercase text-muted-foreground">
                  <span className="text-foreground">1H</span>
                  <span>4H</span>
                  <span>1D</span>
                  <span>W</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">XAUUSD · LAST 60 BARS</div>
              </div>
              <div className="aspect-[21/9] w-full">
                <PriceChart candles={candles} />
              </div>
            </div>
          </div>

          <div className="animate-reveal" style={{ animationDelay: "200ms" }}>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Signal Registry</h3>
              <span className="text-[10px] font-mono text-muted-foreground">Win Rate: <span className="text-foreground">{winRate}%</span></span>
            </div>
            <div className="overflow-x-auto border border-border">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="bg-card border-b border-border">
                    {["ID", "Type", "Entry", "Exit", "P/L Pips", "Status"].map(h => (
                      <th key={h} className="p-3 text-muted-foreground font-normal uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {history.map(h => (
                    <tr key={h.id} className="hover:bg-card/50">
                      <td className="p-3 text-muted-foreground">{h.id}</td>
                      <td className={`p-3 ${h.type === "BUY" ? "text-success" : "text-danger"}`}>{h.type}</td>
                      <td className="p-3">{fmt(h.entry)}</td>
                      <td className="p-3">{fmt(h.exit)}</td>
                      <td className={`p-3 ${h.win ? "text-success" : "text-danger"}`}>
                        {h.win ? "+" : ""}{h.pips.toFixed(1)}
                      </td>
                      <td className="p-3">
                        <span className={`px-1.5 py-0.5 border ${h.win ? "bg-success/10 text-success border-success/20" : "bg-danger/10 text-danger border-danger/20"}`}>
                          {h.win ? "WIN" : "LOSS"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-border pt-6 flex justify-between items-center">
        <div className="flex gap-3 items-center">
          <div className="size-2 bg-success rounded-full animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Real-time data via TwelveData</span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground uppercase">
          Updated: {new Date(fetchedAt).toLocaleTimeString()} · Auto-refresh 60s
        </div>
      </footer>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone: "success" | "danger" | "muted" }) {
  const c = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono ${c}`}>{value}</span>
    </div>
  );
}
