import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSignal, type SignalResult } from "@/lib/signal.functions";
import { PriceChart } from "@/components/PriceChart";
import { PositionSizer } from "@/components/PositionSizer";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Aureum Terminal — XAUUSD Live Signals" },
      { name: "description", content: "High-conviction XAUUSD signals with multi-timeframe confluence, session filter, DXY confirmation, and live backtest stats." },
    ],
  }),
});

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trendColor = (t: string) => t === "UP" ? "text-success" : t === "DOWN" ? "text-danger" : "text-muted-foreground";

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

  const { price, changeAbs, changePct, high, low, candles, indicators, signal, history, backtest, confluence, dxy, fetchedAt } = data;
  const up = changeAbs >= 0;
  const isNeutral = signal.type === "NEUTRAL";
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

        <div className="flex flex-wrap gap-6 items-center">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Live Spot</p>
            <div className="flex items-baseline gap-2 justify-end">
              <span className={`text-3xl font-mono font-bold ${up ? "text-success" : "text-danger"} animate-pulse-slow`}>{fmt(price)}</span>
              <span className={`text-sm font-mono ${up ? "text-success" : "text-danger"}`}>
                {up ? "+" : ""}{fmt(changeAbs)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
              </span>
            </div>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="grid grid-cols-2 gap-x-5 gap-y-1">
            <span className="text-[10px] text-muted-foreground uppercase">24h H</span>
            <span className="text-[10px] font-mono">{fmt(high)}</span>
            <span className="text-[10px] text-muted-foreground uppercase">24h L</span>
            <span className="text-[10px] font-mono">{fmt(low)}</span>
          </div>
          {dxy && (
            <>
              <div className="h-10 w-px bg-border" />
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">DXY</p>
                <div className="flex items-baseline gap-2 justify-end">
                  <span className="text-sm font-mono font-bold">{fmt(dxy.price)}</span>
                  <span className={`text-[10px] font-mono ${dxy.changePct >= 0 ? "text-danger" : "text-success"}`}>
                    {dxy.changePct >= 0 ? "+" : ""}{dxy.changePct}%
                  </span>
                </div>
              </div>
            </>
          )}
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
        {/* Left: Signal + Confluence + Sizer + Indicators */}
        <aside className="col-span-12 lg:col-span-3 space-y-6">
          <div className="bg-card border border-border p-5 animate-reveal">
            <div className="flex justify-between items-center mb-5">
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${sigBg}`}>Active Signal</span>
              <span className="text-xs font-mono text-muted-foreground">{signal.id}</span>
            </div>
            <div className="mb-5">
              <h2 className={`text-4xl font-mono font-bold mb-1 ${sigColor}`}>{signal.type}</h2>
              {signal.playbook !== "NONE" && (
                <span className="inline-block text-[9px] font-mono uppercase tracking-widest border border-accent/40 bg-accent/10 text-accent px-1.5 py-0.5 mb-2">
                  {signal.playbook === "TREND_PULLBACK" ? "Playbook A · Trend Pullback" : "Playbook B · Mean Reversion"}
                </span>
              )}
              <p className="text-sm text-muted-foreground">
                Confidence: <span className="text-foreground font-mono">{signal.confidence}%</span>
                {!isNeutral && <> · R:R <span className="text-accent font-mono">1:{signal.riskReward}</span></>}
              </p>
              <div className="w-full h-1 bg-secondary mt-2">
                <div className={`h-full ${sigBar} transition-all`} style={{ width: `${signal.confidence}%` }} />
              </div>
            </div>
            {!isNeutral && (
              <div className="space-y-3 font-mono mb-4">
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
            )}
            <p className="text-[11px] text-muted-foreground leading-relaxed">{signal.rationale}</p>
          </div>

          {/* Confluence Checklist */}
          <div className="bg-surface border border-border p-5 animate-reveal" style={{ animationDelay: "75ms" }}>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Confluence</h3>
              <span className="text-[10px] font-mono text-muted-foreground">{confluence.passed}/{confluence.total}</span>
            </div>
            <div className="space-y-2.5">
              <Check label={signal.playbook === "MEAN_REVERSION" ? "Range regime active" : "HTF bias aligned"} detail={signal.playbook === "MEAN_REVERSION" ? `ADX ${confluence.adx}` : `H4 ${confluence.h4Trend} · D1 ${confluence.d1Trend}`} pass={signal.playbook === "MEAN_REVERSION" ? confluence.regime === "RANGE" : confluence.h4Trend === confluence.d1Trend && confluence.h4Trend !== "FLAT"} />
              <Check label="Kill zone session" detail={confluence.session} pass={confluence.sessionOk} />
              <Check label="Regime detected" detail={`${confluence.regime} · ADX ${confluence.adx}`} pass={confluence.regime !== "CHOP"} />
              <Check label="DXY inverse" detail={`DXY ${confluence.dxyTrend}`} pass={confluence.dxyOk} />
            </div>
          </div>

          {!isNeutral && <PositionSizer entry={signal.entry} stopLoss={signal.stopLoss} />}

          <div className="bg-surface border border-border p-5 animate-reveal" style={{ animationDelay: "200ms" }}>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">Technical Readout</h3>
            <div className="space-y-3">
              <Row label="RSI (14)" value={`${indicators.rsi} (${indicators.rsiLabel})`} tone={indicators.rsi > 70 ? "danger" : indicators.rsi < 30 ? "success" : "muted"} />
              <Row label="ADX (14)" value={`${indicators.adx} ${indicators.adx >= 25 ? "trending" : indicators.adx < 20 ? "ranging" : "weak"}`} tone={indicators.adx >= 25 ? "success" : "muted"} />
              <Row label="MACD" value={`${indicators.macd > 0 ? "+" : ""}${indicators.macd} ${indicators.macdLabel}`} tone={indicators.macd > 0 ? "success" : "danger"} />
              <Row label="EMA 20 / 50" value={`${fmt(indicators.ema20)} / ${fmt(indicators.ema50)}`} tone="muted" />
              <Row label="EMA 200" value={fmt(indicators.ema200)} tone="muted" />
              <Row label="BB(20,2)" value={`${fmt(indicators.bbLower)} – ${fmt(indicators.bbUpper)}`} tone="muted" />
              <Row label="ATR (14)" value={fmt(indicators.atr)} tone="muted" />
            </div>
          </div>
        </aside>

        {/* Right: Chart + Backtest + History */}
        <div className="col-span-12 lg:col-span-9 space-y-6">
          <div className="animate-reveal" style={{ animationDelay: "150ms" }}>
            <div className="w-full bg-card border border-border flex flex-col">
              <div className="border-b border-border p-3 flex justify-between items-center">
                <div className="flex gap-4 text-[10px] font-mono uppercase text-muted-foreground">
                  <span className="text-foreground">1H</span><span>4H</span><span>1D</span><span>W</span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">XAUUSD · LAST 60 BARS</div>
              </div>
              <div className="aspect-[21/9] w-full">
                <PriceChart candles={candles} />
              </div>
            </div>
          </div>

          {/* Backtest Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-reveal" style={{ animationDelay: "175ms" }}>
            <Stat label="Backtest Trades" value={`${backtest.trades}`} />
            <Stat label="Win Rate" value={`${backtest.winRate}%`} tone={backtest.winRate >= 50 ? "success" : "danger"} />
            <Stat label="Expectancy" value={`${backtest.expectancy > 0 ? "+" : ""}${backtest.expectancy}R`} tone={backtest.expectancy > 0 ? "success" : "danger"} />
            <Stat label="Profit Factor" value={`${backtest.profitFactor}`} tone={backtest.profitFactor >= 1.5 ? "success" : backtest.profitFactor >= 1 ? "muted" : "danger"} />
            <Stat label="Sharpe" value={`${backtest.sharpe}`} tone={backtest.sharpe >= 1 ? "success" : backtest.sharpe >= 0 ? "muted" : "danger"} />
            <Stat label="Sortino" value={`${backtest.sortino}`} tone={backtest.sortino >= 1 ? "success" : backtest.sortino >= 0 ? "muted" : "danger"} />
            <Stat label="Net (R)" value={`${backtest.netR > 0 ? "+" : ""}${backtest.netR}R`} tone={backtest.netR > 0 ? "success" : "danger"} />
            <Stat label="Max DD (R)" value={`-${backtest.maxDrawdownR}R`} tone="danger" />
            <Stat label="In-Sample (70%)" value={`${backtest.inSampleNetR > 0 ? "+" : ""}${backtest.inSampleNetR}R`} tone={backtest.inSampleNetR > 0 ? "success" : "danger"} />
            <Stat label="Out-of-Sample (30%)" value={`${backtest.outSampleNetR > 0 ? "+" : ""}${backtest.outSampleNetR}R`} tone={backtest.outSampleNetR > 0 ? "success" : "danger"} />
          </div>

          <div className="animate-reveal" style={{ animationDelay: "200ms" }}>
            <div className="flex justify-between items-end mb-4">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Signal Registry · Backtest</h3>
              <span className="text-[10px] font-mono text-muted-foreground">Last 200 H1 bars · {backtest.wins}W / {backtest.trades - backtest.wins}L</span>
            </div>
            <div className="overflow-x-auto border border-border">
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="bg-card border-b border-border">
                    {["ID", "Type", "Entry", "Exit", "P/L Pips", "R:R", "Status"].map(h => (
                      <th key={h} className="p-3 text-muted-foreground font-normal uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {history.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No qualifying setups in lookback window — strategy is highly selective.</td></tr>
                  )}
                  {history.map(h => (
                    <tr key={h.id} className="hover:bg-card/50">
                      <td className="p-3 text-muted-foreground">{h.id}</td>
                      <td className={`p-3 ${h.type === "BUY" ? "text-success" : "text-danger"}`}>{h.type}</td>
                      <td className="p-3">{fmt(h.entry)}</td>
                      <td className="p-3">{fmt(h.exit)}</td>
                      <td className={`p-3 ${h.win ? "text-success" : "text-danger"}`}>{h.win ? "+" : ""}{h.pips.toFixed(1)}</td>
                      <td className="p-3 text-muted-foreground">1:{h.rr}</td>
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
            <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed max-w-2xl">
              <strong className="text-foreground">Strategy v3.0 — Adaptive Hybrid:</strong> ADX gates the regime. Trending markets (ADX≥22) trade Playbook A: H4+D1 aligned + price pullback into EMA20/50 + RSI rotation, 1.5×ATR stop, 1:2 RR. Ranging markets (ADX&lt;20) trade Playbook B: BB(20,2) outer-band tag + RSI extreme reversion to mid. Kill-zone sessions only (London / Overlap / NY). DXY inverse confirms. Backtest split 70/30 in-sample / out-of-sample for walk-forward sanity. Sharpe and Sortino reported per-trade R basis.
            </p>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-border pt-6 flex justify-between items-center">
        <div className="flex gap-3 items-center">
          <div className="size-2 bg-success rounded-full animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Live data via TwelveData · Not financial advice</span>
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

function Check({ label, detail, pass }: { label: string; detail: string; pass: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        <span className={`size-3 grid place-items-center text-[9px] ${pass ? "bg-success/20 text-success border border-success/40" : "bg-danger/10 text-danger border border-danger/30"}`}>
          {pass ? "✓" : "✕"}
        </span>
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-[10px] font-mono text-muted-foreground">{detail}</span>
    </div>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: string; tone?: "success" | "danger" | "muted" }) {
  const c = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="bg-surface border border-border p-3">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-mono font-bold ${c}`}>{value}</div>
    </div>
  );
}
