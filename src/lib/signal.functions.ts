import { createServerFn } from "@tanstack/react-start";

export type Candle = { datetime: string; open: number; high: number; low: number; close: number };
type Trend = "UP" | "DOWN" | "FLAT";

type HistoryItem = { id: string; type: "BUY" | "SELL"; entry: number; exit: number; pips: number; win: boolean; rr: number; time: string };

export type SignalResult =
  | {
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
        atr: number;
      };
      confluence: {
        h1Trend: Trend;
        h4Trend: Trend;
        d1Trend: Trend;
        session: "ASIA" | "LONDON" | "NY" | "OVERLAP" | "CLOSED";
        sessionOk: boolean;
        chop: boolean;
        dxyTrend: Trend;
        dxyOk: boolean;
        passed: number;
        total: number;
      };
      signal: {
        type: "BUY" | "SELL" | "NEUTRAL";
        confidence: number;
        entry: number;
        stopLoss: number;
        takeProfit: number;
        riskReward: number;
        id: string;
        rationale: string;
        skipReason?: string;
      };
      backtest: {
        trades: number;
        wins: number;
        winRate: number;
        avgRR: number;
        profitFactor: number;
        maxDrawdownR: number;
        netR: number;
      };
      history: HistoryItem[];
      dxy: { price: number; changePct: number } | null;
      fetchedAt: string;
    }
  | { ok: false; error: string };

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}
function rsiSeries(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(50);
  if (values.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}
function atrCalc(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}
function trendOf(closes: number[], idx: number): Trend {
  if (idx < 200) return "FLAT";
  const e50 = ema(closes.slice(0, idx + 1), 50).at(-1)!;
  const e200 = ema(closes.slice(0, idx + 1), 200).at(-1)!;
  const diff = (e50 - e200) / e200;
  if (diff > 0.001) return "UP";
  if (diff < -0.001) return "DOWN";
  return "FLAT";
}
function resampleHigher(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      datetime: slice[0].datetime,
      open: slice[0].open,
      close: slice[slice.length - 1].close,
      high: Math.max(...slice.map(c => c.high)),
      low: Math.min(...slice.map(c => c.low)),
    });
  }
  return out;
}
function getSession(d: Date): "ASIA" | "LONDON" | "NY" | "OVERLAP" | "CLOSED" {
  const h = d.getUTCHours();
  const day = d.getUTCDay();
  if (day === 6 || (day === 0 && h < 22) || (day === 5 && h >= 21)) return "CLOSED";
  if (h >= 13 && h < 16) return "OVERLAP";
  if (h >= 8 && h < 13) return "LONDON";
  if (h >= 16 && h < 21) return "NY";
  return "ASIA";
}

// Strategy: generate signal from features at index i
function evaluate(closes: number[], candles: Candle[], i: number, dxyTrend: Trend) {
  if (i < 200) return null;
  const window = closes.slice(0, i + 1);
  const ema50v = ema(window, 50).at(-1)!;
  const ema200v = ema(window, 200).at(-1)!;
  const ema12v = ema(window, 12).at(-1)!;
  const ema26v = ema(window, 26).at(-1)!;
  const macd = ema12v - ema26v;
  const macdPrev = ema(window.slice(0, -1), 12).at(-1)! - ema(window.slice(0, -1), 26).at(-1)!;
  const rsi = rsiSeries(window, 14).at(-1)!;
  const price = closes[i];
  const atr = atrCalc(candles.slice(Math.max(0, i - 30), i + 1), 14);

  const h1Trend: Trend = ema50v > ema200v ? "UP" : ema50v < ema200v ? "DOWN" : "FLAT";

  // Higher timeframes
  const h4 = resampleHigher(candles.slice(0, i + 1), 4);
  const d1 = resampleHigher(candles.slice(0, i + 1), 24);
  const h4Trend = h4.length >= 200 ? trendOf(h4.map(c => c.close), h4.length - 1) : h1Trend;
  const d1Trend = d1.length >= 200 ? trendOf(d1.map(c => c.close), d1.length - 1) : h4Trend;

  // Chop filter: price too close to EMAs
  const ribbonWidth = Math.abs(ema50v - ema200v) / price;
  const chop = ribbonWidth < 0.002;

  // Session
  const session = getSession(new Date(candles[i].datetime + "Z"));
  const sessionOk = session === "LONDON" || session === "NY" || session === "OVERLAP";

  // Direction logic
  const trendsAligned = h1Trend === h4Trend && h4Trend === d1Trend && h1Trend !== "FLAT";
  const macdCross = (macd > 0 && macdPrev <= 0) || (macd < 0 && macdPrev >= 0);
  const macdConfirms = (h1Trend === "UP" && macd > 0) || (h1Trend === "DOWN" && macd < 0);

  let type: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let skipReason: string | undefined;

  // DXY confirmation: gold inverse to DXY
  const dxyOk = !dxyTrend || dxyTrend === "FLAT" || (h1Trend === "UP" && dxyTrend === "DOWN") || (h1Trend === "DOWN" && dxyTrend === "UP");

  if (chop) skipReason = "Price inside EMA ribbon — choppy market";
  else if (!sessionOk) skipReason = `Outside London/NY hours (${session})`;
  else if (!trendsAligned) skipReason = "Multi-timeframe trends not aligned";
  else if (!macdConfirms) skipReason = "MACD does not confirm trend";
  else if (h1Trend === "UP" && rsi > 70) skipReason = "RSI overbought — wait for pullback";
  else if (h1Trend === "DOWN" && rsi < 30) skipReason = "RSI oversold — wait for pullback";
  else if (!dxyOk) skipReason = "DXY does not confirm (gold/USD inverse)";
  else type = h1Trend === "UP" ? "BUY" : "SELL";

  // R:R targets — minimum 1:2
  const slDist = Math.max(atr * 1.2, price * 0.002);
  const tpDist = slDist * 2.2;
  const entry = +price.toFixed(2);
  const stopLoss = +(type === "BUY" ? entry - slDist : entry + slDist).toFixed(2);
  const takeProfit = +(type === "BUY" ? entry + tpDist : entry - tpDist).toFixed(2);
  const riskReward = +(tpDist / slDist).toFixed(2);

  let confidence = 50;
  if (trendsAligned) confidence += 15;
  if (macdConfirms) confidence += 8;
  if (sessionOk) confidence += 5;
  if (dxyOk && dxyTrend !== "FLAT") confidence += 7;
  if (macdCross) confidence += 5;
  confidence = Math.min(92, confidence);

  return {
    type, confidence, entry, stopLoss, takeProfit, riskReward,
    h1Trend, h4Trend, d1Trend, session, sessionOk, chop, dxyOk, dxyTrend,
    rsi, macd, ema50v, ema200v, atr, skipReason,
  };
}

// Backtest: simulate strategy on historical bars
function backtest(candles: Candle[], dxyTrend: Trend) {
  const closes = candles.map(c => c.close);
  const trades: HistoryItem[] = [];
  let wins = 0;
  let totalR = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let i = 200;
  while (i < closes.length - 1) {
    const ev = evaluate(closes, candles, i, dxyTrend);
    if (!ev || ev.type === "NEUTRAL") { i++; continue; }
    // Walk forward until SL or TP hit
    let exitIdx = -1;
    let win = false;
    for (let j = i + 1; j < Math.min(i + 48, candles.length); j++) {
      const c = candles[j];
      if (ev.type === "BUY") {
        if (c.low <= ev.stopLoss) { exitIdx = j; win = false; break; }
        if (c.high >= ev.takeProfit) { exitIdx = j; win = true; break; }
      } else {
        if (c.high >= ev.stopLoss) { exitIdx = j; win = false; break; }
        if (c.low <= ev.takeProfit) { exitIdx = j; win = true; break; }
      }
    }
    if (exitIdx === -1) { i += 4; continue; } // no exit, skip
    const r = win ? ev.riskReward : -1;
    totalR += r;
    if (win) { wins++; grossWin += r; } else { grossLoss += 1; }
    equity += r;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
    const exitPrice = win ? ev.takeProfit : ev.stopLoss;
    const pips = (ev.type === "BUY" ? exitPrice - ev.entry : ev.entry - exitPrice) * 10;
    trades.push({
      id: `#${(8800 + i).toString()}`,
      type: ev.type,
      entry: ev.entry,
      exit: +exitPrice.toFixed(2),
      pips: +pips.toFixed(1),
      win,
      rr: ev.riskReward,
      time: candles[i].datetime,
    });
    i = exitIdx + 1;
  }
  const total = trades.length;
  return {
    trades: total,
    wins,
    winRate: total ? +(wins / total * 100).toFixed(1) : 0,
    avgRR: total ? +(totalR / total).toFixed(2) : 0,
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    maxDrawdownR: +maxDD.toFixed(2),
    netR: +totalR.toFixed(2),
    history: trades.slice(-10).reverse(),
  };
}

async function fetchSeries(symbol: string, apiKey: string, size = 300): Promise<Candle[] | null> {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1h&outputsize=${size}&apikey=${apiKey}`;
    const res = await fetch(url);
    const json: any = await res.json();
    if (!json.values) return null;
    return (json.values as any[])
      .map(v => ({ datetime: v.datetime, open: +v.open, high: +v.high, low: +v.low, close: +v.close }))
      .reverse();
  } catch { return null; }
}

export const getSignal = createServerFn({ method: "GET" }).handler(async (): Promise<SignalResult> => {
  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) return { ok: false, error: "TWELVEDATA_API_KEY is not configured" };

  try {
    const [candles, dxyCandles] = await Promise.all([
      fetchSeries("XAU/USD", apiKey, 300),
      fetchSeries("DXY", apiKey, 60),
    ]);
    if (!candles) return { ok: false, error: "Failed to fetch XAU/USD" };

    const closes = candles.map(c => c.close);
    const price = closes.at(-1)!;
    const prev = closes.at(-2) ?? price;
    const changeAbs = price - prev;
    const changePct = (changeAbs / prev) * 100;

    const last24 = candles.slice(-24);
    const high = Math.max(...last24.map(c => c.high));
    const low = Math.min(...last24.map(c => c.low));

    // DXY trend
    let dxyTrend: Trend = "FLAT";
    let dxyInfo: { price: number; changePct: number } | null = null;
    if (dxyCandles && dxyCandles.length > 20) {
      const dCloses = dxyCandles.map(c => c.close);
      const dEma = ema(dCloses, 20).at(-1)!;
      const dPrice = dCloses.at(-1)!;
      const dPrev = dCloses.at(-24) ?? dPrice;
      dxyTrend = dPrice > dEma * 1.0005 ? "UP" : dPrice < dEma * 0.9995 ? "DOWN" : "FLAT";
      dxyInfo = { price: +dPrice.toFixed(2), changePct: +(((dPrice - dPrev) / dPrev) * 100).toFixed(2) };
    }

    const ev = evaluate(closes, candles, closes.length - 1, dxyTrend)!;
    const bt = backtest(candles, dxyTrend);

    let passed = 0;
    const checks = [!ev.chop, ev.sessionOk, ev.h1Trend === ev.h4Trend && ev.h4Trend === ev.d1Trend && ev.h1Trend !== "FLAT", ev.dxyOk];
    passed = checks.filter(Boolean).length;

    const macdLabel = ev.macd > 0 ? "Bullish" : "Bearish";
    const rsiLabel = ev.rsi > 70 ? "Overbought" : ev.rsi < 30 ? "Oversold" : "Neutral";

    const rationale = ev.type === "NEUTRAL"
      ? `No trade — ${ev.skipReason}. Quality > frequency.`
      : `${ev.type === "BUY" ? "Bullish" : "Bearish"} confluence: H1/H4/D1 trends aligned ${ev.h1Trend}, MACD ${ev.macd > 0 ? "+" : ""}${ev.macd.toFixed(2)}, RSI ${ev.rsi.toFixed(1)}, session ${ev.session}, R:R 1:${ev.riskReward}.`;

    return {
      ok: true,
      price: +price.toFixed(2),
      changeAbs: +changeAbs.toFixed(2),
      changePct: +changePct.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      candles: candles.slice(-60),
      indicators: {
        rsi: +ev.rsi.toFixed(1),
        rsiLabel,
        ema50: +ev.ema50v.toFixed(2),
        ema200: +ev.ema200v.toFixed(2),
        macd: +ev.macd.toFixed(3),
        macdSignal: 0,
        macdLabel,
        atr: +ev.atr.toFixed(2),
      },
      confluence: {
        h1Trend: ev.h1Trend, h4Trend: ev.h4Trend, d1Trend: ev.d1Trend,
        session: ev.session, sessionOk: ev.sessionOk, chop: ev.chop,
        dxyTrend, dxyOk: ev.dxyOk,
        passed, total: 4,
      },
      signal: {
        type: ev.type,
        confidence: ev.confidence,
        entry: ev.entry,
        stopLoss: ev.stopLoss,
        takeProfit: ev.takeProfit,
        riskReward: ev.riskReward,
        id: `#${Math.floor(Date.now() / 100000) % 100000}-A`,
        rationale,
        skipReason: ev.skipReason,
      },
      backtest: {
        trades: bt.trades, wins: bt.wins, winRate: bt.winRate,
        avgRR: bt.avgRR, profitFactor: bt.profitFactor,
        maxDrawdownR: bt.maxDrawdownR, netR: bt.netR,
      },
      history: bt.history,
      dxy: dxyInfo,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
});
