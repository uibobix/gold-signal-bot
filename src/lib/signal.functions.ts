import { createServerFn } from "@tanstack/react-start";

export type Candle = { datetime: string; open: number; high: number; low: number; close: number };
type Trend = "UP" | "DOWN" | "FLAT";
type Regime = "TREND" | "CHOP";
type DxySnapshot = { price: number; changePct: number; trend: Trend } | null;

const HOUR_FACTOR_H4 = 4;
const HOUR_FACTOR_D1 = 24;
const EMA_FAST_PERIOD = 50;
const EMA_SLOW_PERIOD = 200;
const CHART_CANDLES = 60;
const BACKTEST_MAX_HOLD_BARS = 60;
const HISTORY_OUTPUT_SIZE = 5000;
const BACKTEST_LOOKBACK = 2000; // last ~83 days of H1 — enough samples, fast on Workers
const MIN_SIGNAL_CANDLES = 260;

type TimeSeriesValue = { datetime: string; open: string; high: string; low: string; close: string };
type TimeSeriesResponse = { values?: TimeSeriesValue[] };

type HistoryItem = {
  id: string;
  type: "BUY" | "SELL";
  entry: number;
  exit: number;
  pips: number;
  win: boolean;
  rr: number;
  time: string;
};

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
        ema20: number;
        ema50: number;
        ema200: number;
        macd: number;
        macdSignal: number;
        macdLabel: string;
        atr: number;
        adx: number;
      };
      confluence: {
        regime: Regime;
        adx: number;
        h4Trend: Trend;
        d1Trend: Trend;
        h1StructureOk: boolean;
        session: "ASIA" | "LONDON" | "NY" | "OVERLAP" | "CLOSED";
        sessionOk: boolean;
        dxyTrend: Trend;
        dxyOk: boolean;
        passed: number;
        total: number;
      };
      signal: {
        type: "BUY" | "SELL" | "NEUTRAL";
        playbook: "TREND_PULLBACK" | "NONE";
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
        expectancy: number;
        sharpe: number;
        sortino: number;
        inSampleNetR: number;
        outSampleNetR: number;
      };
      history: HistoryItem[];
      dxy: { price: number; changePct: number } | null;
      strategy: { name: string; version: string; notes: string };
      fetchedAt: string;
    }
  | { ok: false; error: string };

// =============== indicator series (all O(n), computed once) ===============
function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsiSeries(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(50);
  if (values.length < period + 1) return out;
  let g = 0,
    l = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) g += d;
    else l -= d;
  }
  let avgG = g / period,
    avgL = l / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const gg = d > 0 ? d : 0,
      ll = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + gg) / period;
    avgL = (avgL * (period - 1) + ll) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function atrSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out: number[] = new Array(n).fill(0);
  if (n < 2) return out;
  const trs: number[] = new Array(n);
  trs[0] = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i],
      p = candles[i - 1];
    trs[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }
  let sum = 0;
  for (let i = 1; i < n; i++) {
    if (i <= period) {
      sum += trs[i];
      if (i === period) out[i] = sum / period;
    } else {
      out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
    }
  }
  return out;
}

// Wilder ADX series — O(n)
function adxSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array(n).fill(0);
  if (n < period * 2 + 2) return out;
  const tr: number[] = new Array(n);
  const pdm: number[] = new Array(n);
  const ndm: number[] = new Array(n);
  tr[0] = pdm[0] = ndm[0] = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i],
      p = candles[i - 1];
    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const up = c.high - p.high;
    const dn = p.low - c.low;
    pdm[i] = up > dn && up > 0 ? up : 0;
    ndm[i] = dn > up && dn > 0 ? dn : 0;
  }
  let trS = 0,
    pS = 0,
    nS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += pdm[i];
    nS += ndm[i];
  }
  let dxSum = 0;
  let dxCount = 0;
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + pdm[i];
    nS = nS - nS / period + ndm[i];
    const pdi = trS > 0 ? (pS / trS) * 100 : 0;
    const ndi = trS > 0 ? (nS / trS) * 100 : 0;
    const sum = pdi + ndi;
    const dx = sum > 0 ? (Math.abs(pdi - ndi) / sum) * 100 : 0;
    if (dxCount < period) {
      dxSum += dx;
      dxCount++;
      if (dxCount === period) out[i] = dxSum / period;
    } else {
      out[i] = (out[i - 1] * (period - 1) + dx) / period;
    }
  }
  return out;
}

// Resample to higher TF — used to compute HTF EMAs which we then map back per H1 index
function resampleHigher(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const s = candles.slice(i, i + factor);
    out.push({
      datetime: s[0].datetime,
      open: s[0].open,
      close: s[s.length - 1].close,
      high: Math.max(...s.map((c) => c.high)),
      low: Math.min(...s.map((c) => c.low)),
    });
  }
  return out;
}

// For each H1 index, return trend (UP/DOWN/FLAT) at the most recent CLOSED HTF bar
function buildHtfTrendByIndex(candles: Candle[], factor: number): Trend[] {
  const htf = resampleHigher(candles, factor);
  const closes = htf.map((c) => c.close);
  const e50 = emaSeries(closes, EMA_FAST_PERIOD);
  const e200 = emaSeries(closes, EMA_SLOW_PERIOD);
  const trendAtHtf: Trend[] = htf.map((_, j) => {
    if (j < EMA_SLOW_PERIOD) return "FLAT";
    const diff = (e50[j] - e200[j]) / e200[j];
    if (diff > 0.001) return "UP";
    if (diff < -0.001) return "DOWN";
    return "FLAT";
  });
  // map every H1 index to trend at most-recently-CLOSED HTF bucket (j-1)
  const out: Trend[] = new Array(candles.length).fill("FLAT");
  for (let i = 0; i < candles.length; i++) {
    const j = Math.floor(i / factor) - 1;
    if (j >= 0) out[i] = trendAtHtf[j];
  }
  return out;
}

function getSession(d: Date): "ASIA" | "LONDON" | "NY" | "OVERLAP" | "CLOSED" {
  const h = d.getUTCHours(),
    day = d.getUTCDay();
  if (day === 6 || (day === 0 && h < 22) || (day === 5 && h >= 21)) return "CLOSED";
  if (h >= 13 && h < 16) return "OVERLAP";
  if (h >= 7 && h < 13) return "LONDON";
  if (h >= 16 && h < 20) return "NY";
  return "ASIA";
}

function buildDxySnapshots(dxyCandles: Candle[] | null): {
  trendByIndex: Trend[];
  latest: DxySnapshot;
} {
  if (!dxyCandles || dxyCandles.length === 0) return { trendByIndex: [], latest: null };
  const closes = dxyCandles.map((c) => c.close);
  const e20 = emaSeries(closes, 20);
  const trendByIndex = dxyCandles.map((c, i) => {
    const m = e20[i] ?? c.close;
    if (c.close > m * 1.0005) return "UP" as Trend;
    if (c.close < m * 0.9995) return "DOWN" as Trend;
    return "FLAT" as Trend;
  });
  const last = closes.at(-1)!;
  const prior = closes.at(-24) ?? last;
  return {
    trendByIndex,
    latest: {
      price: +last.toFixed(2),
      changePct: +(((last - prior) / prior) * 100).toFixed(2),
      trend: trendByIndex.at(-1) ?? "FLAT",
    },
  };
}

function alignDxyTrends(targetCandles: Candle[], dxyCandles: Candle[] | null): Trend[] {
  if (!dxyCandles || dxyCandles.length === 0)
    return new Array(targetCandles.length).fill("FLAT") as Trend[];
  const { trendByIndex } = buildDxySnapshots(dxyCandles);
  const aligned: Trend[] = [];
  let dxyIdx = 0;
  let cur: Trend = "FLAT";
  for (const c of targetCandles) {
    while (dxyIdx < dxyCandles.length && dxyCandles[dxyIdx].datetime <= c.datetime) {
      cur = trendByIndex[dxyIdx] ?? cur;
      dxyIdx++;
    }
    aligned.push(cur);
  }
  return aligned;
}

// =============== precomputed context ===============
type Ctx = {
  candles: Candle[];
  closes: number[];
  ema12: number[];
  ema20: number[];
  ema26: number[];
  ema50: number[];
  ema200: number[];
  rsi: number[];
  atr: number[];
  adx: number[];
  h4: Trend[];
  d1: Trend[];
  dxy: Trend[];
};

function buildCtx(candles: Candle[], dxy: Trend[]): Ctx {
  const closes = candles.map((c) => c.close);
  return {
    candles,
    closes,
    ema12: emaSeries(closes, 12),
    ema20: emaSeries(closes, 20),
    ema26: emaSeries(closes, 26),
    ema50: emaSeries(closes, 50),
    ema200: emaSeries(closes, 200),
    rsi: rsiSeries(closes, 14),
    atr: atrSeries(candles, 14),
    adx: adxSeries(candles, 14),
    h4: buildHtfTrendByIndex(candles, HOUR_FACTOR_H4),
    d1: buildHtfTrendByIndex(candles, HOUR_FACTOR_D1),
    dxy,
  };
}

// =============== single-sleeve trend evaluator (O(1) per index) ===============
function evaluateAt(ctx: Ctx, i: number) {
  if (i < EMA_SLOW_PERIOD + 2) return null;
  const cur = ctx.candles[i];
  const price = ctx.closes[i];
  const ema20v = ctx.ema20[i];
  const ema50v = ctx.ema50[i];
  const ema200v = ctx.ema200[i];
  const macd = ctx.ema12[i] - ctx.ema26[i];
  const rsi = ctx.rsi[i];
  const rsiPrev = ctx.rsi[i - 1];
  const atr = ctx.atr[i];
  const adx = ctx.adx[i];
  const h4Trend = ctx.h4[i];
  const d1Trend = ctx.d1[i];
  const dxyTrend = ctx.dxy[i] ?? "FLAT";

  const htfBias: Trend = h4Trend === d1Trend && h4Trend !== "FLAT" ? h4Trend : "FLAT";
  const h1StructureOk =
    htfBias === "UP"
      ? price > ema200v && ema20v > ema50v && ema50v > ema200v
      : htfBias === "DOWN"
        ? price < ema200v && ema20v < ema50v && ema50v < ema200v
        : false;

  const regime: Regime = adx >= 22 && htfBias !== "FLAT" ? "TREND" : "CHOP";
  const session = getSession(new Date(cur.datetime + "Z"));
  const sessionOk = session === "LONDON" || session === "NY" || session === "OVERLAP";
  const dxyOk =
    dxyTrend === "FLAT" ||
    (htfBias === "UP" && dxyTrend === "DOWN") ||
    (htfBias === "DOWN" && dxyTrend === "UP");

  const bullCandle = cur.close > cur.open && cur.close > (cur.open + cur.high) / 2;
  const bearCandle = cur.close < cur.open && cur.close < (cur.open + cur.low) / 2;

  let type: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let playbook: "TREND_PULLBACK" | "NONE" = "NONE";
  const entry = +price.toFixed(2);
  let stopLoss = entry,
    takeProfit = entry,
    riskReward = 0;
  let skipReason: string | undefined;

  if (regime === "TREND" && sessionOk && htfBias !== "FLAT") {
    const emaHi = Math.max(ema20v, ema50v);
    const emaLo = Math.min(ema20v, ema50v);
    const inPullback = price >= emaLo - atr * 0.3 && price <= emaHi + atr * 0.3;
    if (
      htfBias === "UP" &&
      h1StructureOk &&
      inPullback &&
      rsi >= 42 &&
      rsi <= 62 &&
      rsi > rsiPrev &&
      bullCandle &&
      rsi < 75
    ) {
      playbook = "TREND_PULLBACK";
      type = "BUY";
      const slDist = atr * 1.5;
      stopLoss = +(entry - slDist).toFixed(2);
      takeProfit = +(entry + slDist * 2).toFixed(2);
      riskReward = 2;
    } else if (
      htfBias === "DOWN" &&
      h1StructureOk &&
      inPullback &&
      rsi <= 58 &&
      rsi >= 38 &&
      rsi < rsiPrev &&
      bearCandle &&
      rsi > 25
    ) {
      playbook = "TREND_PULLBACK";
      type = "SELL";
      const slDist = atr * 1.5;
      stopLoss = +(entry + slDist).toFixed(2);
      takeProfit = +(entry - slDist * 2).toFixed(2);
      riskReward = 2;
    } else if (!h1StructureOk) {
      skipReason = "HTF bias present, but H1 EMAs not stacked with the trend";
    } else if (!inPullback) {
      skipReason = "Trend regime — price extended away from EMA20/50, waiting for pullback";
    } else {
      skipReason = "Trend regime — pullback active, waiting for momentum confirmation";
    }
  } else {
    if (regime === "CHOP" && htfBias === "FLAT")
      skipReason = `No trend (ADX ${adx.toFixed(0)}) and H4/D1 not aligned (${h4Trend}/${d1Trend})`;
    else if (regime === "CHOP")
      skipReason = `Trend strength too weak (ADX ${adx.toFixed(0)}, need ≥22)`;
    else if (!sessionOk) skipReason = `Outside kill zones (${session})`;
    else skipReason = `H4 (${h4Trend}) and D1 (${d1Trend}) not aligned`;
  }

  let confidence = 50;
  if (type !== "NEUTRAL") {
    confidence = 58;
    if (adx >= 28) confidence += 6;
    if (h4Trend === d1Trend) confidence += 6;
    if (h1StructureOk) confidence += 6;
    if (dxyOk) confidence += 4;
    else confidence -= 4;
    if (session === "OVERLAP") confidence += 4;
  }
  confidence = Math.max(45, Math.min(88, confidence));

  return {
    type,
    playbook,
    confidence,
    entry,
    stopLoss,
    takeProfit,
    riskReward,
    h4Trend,
    d1Trend,
    h1StructureOk,
    session,
    sessionOk,
    dxyTrend,
    dxyOk,
    rsi,
    macd,
    ema20v,
    ema50v,
    ema200v,
    atr,
    adx,
    regime,
    skipReason,
    htfBias,
  };
}

// =============== fast backtest ===============
function backtest(ctx: Ctx) {
  const { candles } = ctx;
  const trades: HistoryItem[] = [];
  const rs: number[] = [];
  let wins = 0,
    totalR = 0,
    grossWin = 0,
    grossLoss = 0;
  let equity = 0,
    peak = 0,
    maxDD = 0;
  // Walk-forward 70/30 split applied on the backtest window
  const start = Math.max(EMA_SLOW_PERIOD + 2, candles.length - BACKTEST_LOOKBACK);
  const splitIdx = start + Math.floor((candles.length - start) * 0.7);
  let inSampleR = 0,
    outSampleR = 0;
  let i = start;
  while (i < candles.length - 1) {
    const ev = evaluateAt(ctx, i);
    if (!ev || ev.type === "NEUTRAL") {
      i++;
      continue;
    }
    let exitIdx = -1,
      win = false;
    const limit = Math.min(i + BACKTEST_MAX_HOLD_BARS, candles.length);
    for (let j = i + 1; j < limit; j++) {
      const c = candles[j];
      if (ev.type === "BUY") {
        if (c.low <= ev.stopLoss) {
          exitIdx = j;
          win = false;
          break;
        }
        if (c.high >= ev.takeProfit) {
          exitIdx = j;
          win = true;
          break;
        }
      } else {
        if (c.high >= ev.stopLoss) {
          exitIdx = j;
          win = false;
          break;
        }
        if (c.low <= ev.takeProfit) {
          exitIdx = j;
          win = true;
          break;
        }
      }
    }
    if (exitIdx === -1) {
      i += 4;
      continue;
    }
    const r = win ? ev.riskReward : -1;
    rs.push(r);
    totalR += r;
    if (i < splitIdx) inSampleR += r;
    else outSampleR += r;
    if (win) {
      wins++;
      grossWin += r;
    } else grossLoss += 1;
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
  const winRate = total ? wins / total : 0;
  const expectancy = total ? totalR / total : 0;
  const meanR = expectancy;
  const sd =
    rs.length > 1 ? Math.sqrt(rs.reduce((a, b) => a + (b - meanR) ** 2, 0) / rs.length) : 0;
  const downside = rs.filter((r) => r < 0);
  const dd =
    downside.length > 1 ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length) : 0;
  const sharpe = sd > 0 ? +((meanR / sd) * Math.sqrt(rs.length)).toFixed(2) : 0;
  const sortino = dd > 0 ? +((meanR / dd) * Math.sqrt(rs.length)).toFixed(2) : 0;
  return {
    trades: total,
    wins,
    winRate: +(winRate * 100).toFixed(1),
    avgRR: +expectancy.toFixed(2),
    expectancy: +expectancy.toFixed(2),
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0,
    maxDrawdownR: +maxDD.toFixed(2),
    netR: +totalR.toFixed(2),
    sharpe,
    sortino,
    inSampleNetR: +inSampleR.toFixed(2),
    outSampleNetR: +outSampleR.toFixed(2),
    history: trades.slice(-12).reverse(),
  };
}

async function fetchSeries(
  symbol: string,
  apiKey: string,
  size = HISTORY_OUTPUT_SIZE,
): Promise<Candle[] | null> {
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1h&outputsize=${size}&apikey=${apiKey}`;
    const res = await fetch(url);
    const json = (await res.json()) as TimeSeriesResponse;
    if (!json.values) return null;
    return json.values
      .map((v) => ({
        datetime: v.datetime,
        open: +v.open,
        high: +v.high,
        low: +v.low,
        close: +v.close,
      }))
      .reverse();
  } catch {
    return null;
  }
}

export const getSignal = createServerFn({ method: "GET" }).handler(
  async (): Promise<SignalResult> => {
    const apiKey = process.env.TWELVEDATA_API_KEY;
    if (!apiKey) return { ok: false, error: "TWELVEDATA_API_KEY is not configured" };

    try {
      const [candles, dxyCandles] = await Promise.all([
        fetchSeries("XAU/USD", apiKey, HISTORY_OUTPUT_SIZE),
        fetchSeries("DXY", apiKey, HISTORY_OUTPUT_SIZE),
      ]);
      if (!candles || candles.length < MIN_SIGNAL_CANDLES)
        return { ok: false, error: "Failed to fetch sufficient XAU/USD history" };

      const closes = candles.map((c) => c.close);
      const price = closes.at(-1)!;
      const prev = closes.at(-2) ?? price;
      const changeAbs = price - prev;
      const changePct = (changeAbs / prev) * 100;
      const last24 = candles.slice(-24);
      const high = Math.max(...last24.map((c) => c.high));
      const low = Math.min(...last24.map((c) => c.low));

      const alignedDxy = alignDxyTrends(candles, dxyCandles);
      const dxySnapshot = buildDxySnapshots(dxyCandles).latest;

      const ctx = buildCtx(candles, alignedDxy);
      const ev = evaluateAt(ctx, candles.length - 1)!;
      const bt = backtest(ctx);

      const checks = [
        ev.regime === "TREND",
        ev.h4Trend === ev.d1Trend && ev.h4Trend !== "FLAT",
        ev.h1StructureOk,
        ev.sessionOk,
        ev.dxyOk,
      ];
      const passed = checks.filter(Boolean).length;

      const macdLabel = ev.macd > 0 ? "Bullish" : "Bearish";
      const rsiLabel = ev.rsi > 70 ? "Overbought" : ev.rsi < 30 ? "Oversold" : "Neutral";

      const rationale =
        ev.type === "NEUTRAL"
          ? `Stand aside — ${ev.skipReason}. Quality > frequency.`
          : `${ev.type} via Trend Pullback: ADX ${ev.adx.toFixed(0)}, H4+D1 ${ev.htfBias}, H1 stacked, pullback into EMA20/50, RSI ${ev.rsi.toFixed(0)}, ${ev.session}. Stop 1.5×ATR, target 1:2.`;

      return {
        ok: true,
        price: +price.toFixed(2),
        changeAbs: +changeAbs.toFixed(2),
        changePct: +changePct.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        candles: candles.slice(-CHART_CANDLES),
        indicators: {
          rsi: +ev.rsi.toFixed(1),
          rsiLabel,
          ema20: +ev.ema20v.toFixed(2),
          ema50: +ev.ema50v.toFixed(2),
          ema200: +ev.ema200v.toFixed(2),
          macd: +ev.macd.toFixed(3),
          macdSignal: 0,
          macdLabel,
          atr: +ev.atr.toFixed(2),
          adx: +ev.adx.toFixed(1),
        },
        confluence: {
          regime: ev.regime,
          adx: +ev.adx.toFixed(1),
          h4Trend: ev.h4Trend,
          d1Trend: ev.d1Trend,
          h1StructureOk: ev.h1StructureOk,
          session: ev.session,
          sessionOk: ev.sessionOk,
          dxyTrend: ev.dxyTrend,
          dxyOk: ev.dxyOk,
          passed,
          total: 5,
        },
        signal: {
          type: ev.type,
          playbook: ev.playbook,
          confidence: ev.confidence,
          entry: ev.entry,
          stopLoss: ev.stopLoss,
          takeProfit: ev.takeProfit,
          riskReward: ev.riskReward,
          id: `#${Math.floor(Date.now() / 100000) % 100000}-H`,
          rationale,
          skipReason: ev.skipReason,
        },
        backtest: {
          trades: bt.trades,
          wins: bt.wins,
          winRate: bt.winRate,
          avgRR: bt.avgRR,
          expectancy: bt.expectancy,
          profitFactor: bt.profitFactor,
          maxDrawdownR: bt.maxDrawdownR,
          netR: bt.netR,
          sharpe: bt.sharpe,
          sortino: bt.sortino,
          inSampleNetR: bt.inSampleNetR,
          outSampleNetR: bt.outSampleNetR,
        },
        history: bt.history,
        dxy: dxySnapshot ? { price: dxySnapshot.price, changePct: dxySnapshot.changePct } : null,
        strategy: {
          name: "Single-Sleeve Trend Pullback",
          version: "v4.1",
          notes:
            "Indicators precomputed once per request — backtest now runs O(n) over the last ~2000 H1 bars instead of O(n²). Same rules: ADX≥22, H4/D1 alignment, stacked H1 EMAs, pullback into EMA20/50, RSI rotation, kill-zone session, DXY confidence input. 70/30 walk-forward split.",
        },
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },
);
