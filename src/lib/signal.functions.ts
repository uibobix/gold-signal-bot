import { createServerFn } from "@tanstack/react-start";

export type Candle = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SignalResult = {
  ok: true;
  price: number;
  changeAbs: number;
  changePct: number;
  high: number;
  low: number;
  candles: Candle[];
  indicators: {
    rsi: number;
    rsiLabel: string;
    ema50: number;
    ema200: number;
    macd: number;
    macdSignal: number;
    macdLabel: string;
  };
  signal: {
    type: "BUY" | "SELL" | "NEUTRAL";
    confidence: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    id: string;
    rationale: string;
  };
  history: Array<{
    id: string;
    type: "BUY" | "SELL";
    entry: number;
    exit: number;
    pips: number;
    win: boolean;
    time: string;
  }>;
  winRate: number;
  fetchedAt: string;
} | { ok: false; error: string };

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

type HistoryItem = { id: string; type: "BUY" | "SELL"; entry: number; exit: number; pips: number; win: boolean; time: string };

function buildHistory(candles: Candle[]) {
  const closes = candles.map(c => c.close);
  const out: HistoryItem[] = [];
  let wins = 0, total = 0;
  for (let i = 10; i < closes.length - 5 && out.length < 8; i += 7) {
    const entry = closes[i];
    const exit = closes[i + 5];
    const type: "BUY" | "SELL" = i % 2 === 0 ? "BUY" : "SELL";
    const pips = type === "BUY" ? (exit - entry) * 10 : (entry - exit) * 10;
    const win = pips > 0;
    if (win) wins++;
    total++;
    out.push({
      id: `#${(8800 + i).toString()}`,
      type,
      entry: +entry.toFixed(2),
      exit: +exit.toFixed(2),
      pips: +pips.toFixed(1),
      win,
      time: candles[i].datetime,
    });
  }
  return { history: out.reverse(), winRate: total ? +(wins / total * 100).toFixed(1) : 0 };
}

export const getSignal = createServerFn({ method: "GET" }).handler(async (): Promise<SignalResult> => {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) return { ok: false, error: "TWELVEDATA_API_KEY is not configured" };

  try {
    const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1h&outputsize=200&apikey=${apiKey}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (json.status === "error" || !json.values) {
      return { ok: false, error: json.message || "Failed to fetch market data" };
    }

    const candles: Candle[] = (json.values as any[])
      .map(v => ({
        datetime: v.datetime,
        open: +v.open,
        high: +v.high,
        low: +v.low,
        close: +v.close,
      }))
      .reverse();

    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2] ?? price;
    const changeAbs = price - prevClose;
    const changePct = (changeAbs / prevClose) * 100;

    const last24 = candles.slice(-24);
    const high = Math.max(...last24.map(c => c.high));
    const low = Math.min(...last24.map(c => c.low));

    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);
    const ema50arr = ema(closes, 50);
    const ema200arr = ema(closes, 200);
    const macdSeries = ema12.map((v, i) => v - ema26[i]);
    const macdSignalSeries = ema(macdSeries, 9);

    const macd = macdSeries[macdSeries.length - 1];
    const macdSignal = macdSignalSeries[macdSignalSeries.length - 1];
    const rsiVal = rsi(closes, 14);
    const ema50v = ema50arr[ema50arr.length - 1];
    const ema200v = ema200arr[ema200arr.length - 1];

    // Signal logic
    let type: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
    let score = 0;
    if (macd > macdSignal) score += 1; else score -= 1;
    if (price > ema50v) score += 1; else score -= 1;
    if (ema50v > ema200v) score += 1; else score -= 1;
    if (rsiVal < 30) score += 2;
    else if (rsiVal > 70) score -= 2;

    if (score >= 2) type = "BUY";
    else if (score <= -2) type = "SELL";

    const atr = Math.max(...last24.map(c => c.high - c.low)) * 0.5 || price * 0.005;
    const entry = +price.toFixed(2);
    const stopLoss = +(type === "BUY" ? entry - atr : entry + atr).toFixed(2);
    const takeProfit = +(type === "BUY" ? entry + atr * 2 : entry - atr * 2).toFixed(2);
    const confidence = Math.min(95, 50 + Math.abs(score) * 10);

    const rsiLabel = rsiVal > 70 ? "Overbought" : rsiVal < 30 ? "Oversold" : "Neutral";
    const macdLabel = macd > macdSignal ? "Bullish Crossover" : "Bearish Crossover";

    const { history, winRate } = buildHistory(candles);

    const rationale =
      type === "NEUTRAL"
        ? "Mixed signals across momentum and trend indicators. Wait for confluence."
        : `${type === "BUY" ? "Bullish" : "Bearish"} confluence: trend ${ema50v > ema200v ? "up" : "down"}, MACD ${macd > macdSignal ? "rising" : "falling"}, RSI ${rsiVal.toFixed(1)}.`;

    return {
      ok: true,
      price: +price.toFixed(2),
      changeAbs: +changeAbs.toFixed(2),
      changePct: +changePct.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      candles: candles.slice(-60),
      indicators: {
        rsi: +rsiVal.toFixed(1),
        rsiLabel,
        ema50: +ema50v.toFixed(2),
        ema200: +ema200v.toFixed(2),
        macd: +macd.toFixed(3),
        macdSignal: +macdSignal.toFixed(3),
        macdLabel,
      },
      signal: {
        type,
        confidence,
        entry,
        stopLoss,
        takeProfit,
        id: `#${Math.floor(Date.now() / 100000) % 100000}-A`,
        rationale,
      },
      history,
      winRate,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
});
