import { createServerFn } from "@tanstack/react-start";

export type Candle = { datetime: string; open: number; high: number; low: number; close: number };
type Trend = "UP" | "DOWN" | "FLAT";
type Regime = "TREND" | "RANGE" | "CHOP";
type DxySnapshot = { price: number; changePct: number; trend: Trend } | null;

const HOUR_FACTOR_H4 = 4;
const HOUR_FACTOR_D1 = 24;
const EMA_FAST_PERIOD = 50;
const EMA_SLOW_PERIOD = 200;
const CHART_CANDLES = 60;
const BACKTEST_MAX_HOLD_BARS = 60;
const HISTORY_OUTPUT_SIZE = 5000;
const MIN_SIGNAL_CANDLES = 220;
type TimeSeriesValue = {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
};
type TimeSeriesResponse = {
  values?: TimeSeriesValue[];
};

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
        bbUpper: number;
        bbLower: number;
        bbMid: number;
      };
      confluence: {
        regime: Regime;
        adx: number;
        h4Trend: Trend;
        d1Trend: Trend;
        session: "ASIA" | "LONDON" | "NY" | "OVERLAP" | "CLOSED";
        sessionOk: boolean;
        dxyTrend: Trend;
        dxyOk: boolean;
        passed: number;
        total: number;
      };
      signal: {
        type: "BUY" | "SELL" | "NEUTRAL";
        playbook: "TREND_PULLBACK" | "MEAN_REVERSION" | "NONE";
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

// =============== math primitives ===============
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}
function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1];
  const s = values.slice(-period).reduce((a, b) => a + b, 0);
  return s / period;
}
function stdev(values: number[], period: number): number {
  const slice = values.slice(-period);
  const m = slice.reduce((a, b) => a + b, 0) / slice.length;
  const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length;
  return Math.sqrt(v);
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
  const out: number[] = new Array(candles.length).fill(0);
  const trs: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i],
      p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  let sum = 0;
  for (let i = 1; i < candles.length; i++) {
    sum += trs[i];
    if (i < period) continue;
    if (i === period) out[i] = sum / period;
    else out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}
// Wilder ADX — trend strength (>25 = trending, <20 = ranging)
function adxSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const out = new Array(n).fill(0);
  if (n < period * 2) return out;
  const tr: number[] = [0],
    pdm: number[] = [0],
    ndm: number[] = [0];
  for (let i = 1; i < n; i++) {
    const c = candles[i],
      p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high,
      dn = p.low - c.low;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  // Wilder smoothing
  let trS = 0,
    pS = 0,
    nS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += pdm[i];
    nS += ndm[i];
  }
  const dxArr: number[] = [];
  for (let i = period + 1; i < n; i++) {
    trS = trS - trS / period + tr[i];
    pS = pS - pS / period + pdm[i];
    nS = nS - nS / period + ndm[i];
    const pdi = (pS / trS) * 100;
    const ndi = (nS / trS) * 100;
    const dx = (Math.abs(pdi - ndi) / (pdi + ndi || 1)) * 100;
    dxArr.push(dx);
    if (dxArr.length >= period) {
      const slice = dxArr.slice(-period);
      out[i] = slice.reduce((a, b) => a + b, 0) / period;
    }
  }
  return out;
}
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
function htfTrend(closes: number[]): Trend {
  if (closes.length < EMA_SLOW_PERIOD) return "FLAT";
  const e50 = ema(closes, EMA_FAST_PERIOD).at(-1)!;
  const e200 = ema(closes, EMA_SLOW_PERIOD).at(-1)!;
  const diff = (e50 - e200) / e200;
  if (diff > 0.001) return "UP";
  if (diff < -0.001) return "DOWN";
  return "FLAT";
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
  trendByTargetIndex: Trend[];
  latest: DxySnapshot;
} {
  if (!dxyCandles || dxyCandles.length === 0) {
    return { trendByTargetIndex: [], latest: null };
  }

  const closes = dxyCandles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const trendByTargetIndex = dxyCandles.map((candle, index) => {
    const currentEma = ema20[index] ?? candle.close;
    if (candle.close > currentEma * 1.0005) return "UP";
    if (candle.close < currentEma * 0.9995) return "DOWN";
    return "FLAT";
  });

  const latestClose = closes.at(-1)!;
  const priorClose = closes.at(-24) ?? latestClose;

  return {
    trendByTargetIndex,
    latest: {
      price: +latestClose.toFixed(2),
      changePct: +(((latestClose - priorClose) / priorClose) * 100).toFixed(2),
      trend: trendByTargetIndex.at(-1) ?? "FLAT",
    },
  };
}

function alignDxyTrends(targetCandles: Candle[], dxyCandles: Candle[] | null): Trend[] {
  if (!dxyCandles || dxyCandles.length === 0) {
    return new Array(targetCandles.length).fill("FLAT");
  }

  const { trendByTargetIndex } = buildDxySnapshots(dxyCandles);
  const aligned: Trend[] = [];
  let dxyIndex = 0;
  let currentTrend: Trend = "FLAT";

  for (const candle of targetCandles) {
    while (dxyIndex < dxyCandles.length && dxyCandles[dxyIndex].datetime <= candle.datetime) {
      currentTrend = trendByTargetIndex[dxyIndex] ?? currentTrend;
      dxyIndex += 1;
    }
    aligned.push(currentTrend);
  }

  return aligned;
}

// =============== adaptive hybrid evaluator ===============
// Playbooks (selected by regime):
//   A. TREND_PULLBACK: ADX>22 + H4+D1 aligned + price pulled back to EMA20/50 zone
//      + RSI returning from 40-60 + bullish/bearish candle. SL=1.5*ATR, TP=2*risk (1:2).
//   B. MEAN_REVERSION: ADX<20 + price tagged BB(20,2) outer band + RSI extreme
//      (>70 short / <30 long) + against H4 trend allowed. SL=1*ATR, TP=BB mid (1:1+).
function evaluateAt(candles: Candle[], i: number, dxyTrend: Trend) {
  if (i < EMA_SLOW_PERIOD) return null;
  const window = candles.slice(0, i + 1);
  const closes = window.map((c) => c.close);
  const ema20v = ema(closes, 20).at(-1)!;
  const ema50v = ema(closes, 50).at(-1)!;
  const ema200v = ema(closes, 200).at(-1)!;
  const macd = ema(closes, 12).at(-1)! - ema(closes, 26).at(-1)!;
  const rsiArr = rsiSeries(closes, 14);
  const rsi = rsiArr.at(-1)!;
  const rsiPrev = rsiArr.at(-2)!;
  const atrArr = atrSeries(window, 14);
  const atr = atrArr.at(-1)!;
  const adxArr = adxSeries(window, 14);
  const adx = adxArr.at(-1)!;
  const bbMid = sma(closes, 20);
  const bbStd = stdev(closes, 20);
  const bbUpper = bbMid + 2 * bbStd;
  const bbLower = bbMid - 2 * bbStd;
  const price = closes[i];
  const cur = candles[i];

  // HTF bias (H4 + D1 from H1 base)
  const h4 = resampleHigher(window, HOUR_FACTOR_H4);
  const d1 = resampleHigher(window, HOUR_FACTOR_D1);
  const h4Trend: Trend = htfTrend(h4.map((c) => c.close));
  const d1Trend: Trend = htfTrend(d1.map((c) => c.close));
  const htfBias: Trend = h4Trend === d1Trend && h4Trend !== "FLAT" ? h4Trend : "FLAT";

  // Regime classification (per research: ADX as regime gate)
  let regime: Regime = "CHOP";
  if (adx >= 22) regime = "TREND";
  else if (adx < 20) regime = "RANGE";

  const session = getSession(new Date(cur.datetime + "Z"));
  const sessionOk = session === "LONDON" || session === "NY" || session === "OVERLAP";
  const dxyOk =
    dxyTrend === "FLAT" ||
    (htfBias === "UP" && dxyTrend === "DOWN") ||
    (htfBias === "DOWN" && dxyTrend === "UP");

  // Bullish/bearish close confirmation
  const bullCandle = cur.close > cur.open && cur.close > (cur.open + cur.high) / 2;
  const bearCandle = cur.close < cur.open && cur.close < (cur.open + cur.low) / 2;

  let type: "BUY" | "SELL" | "NEUTRAL" = "NEUTRAL";
  let playbook: "TREND_PULLBACK" | "MEAN_REVERSION" | "NONE" = "NONE";
  const entry = +price.toFixed(2);
  let stopLoss = entry,
    takeProfit = entry,
    riskReward = 0;
  let skipReason: string | undefined;

  // ---------- Playbook A: Trend Pullback ----------
  if (regime === "TREND" && sessionOk && htfBias !== "FLAT") {
    // Pullback zone: between EMA20 and EMA50
    const emaHi = Math.max(ema20v, ema50v);
    const emaLo = Math.min(ema20v, ema50v);
    const inPullback = price >= emaLo - atr * 0.3 && price <= emaHi + atr * 0.3;
    if (
      htfBias === "UP" &&
      inPullback &&
      rsi > 40 &&
      rsi < 65 &&
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
      inPullback &&
      rsi < 60 &&
      rsi > 35 &&
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
    } else {
      skipReason = "Trend regime — waiting for clean pullback to EMA20/50 + momentum return";
    }
  }
  // ---------- Playbook B: Mean Reversion ----------
  else if (regime === "RANGE" && sessionOk) {
    const tagUpper = cur.high >= bbUpper && cur.close < bbUpper;
    const tagLower = cur.low <= bbLower && cur.close > bbLower;
    if (tagLower && rsi < 32 && bullCandle) {
      playbook = "MEAN_REVERSION";
      type = "BUY";
      const slDist = atr * 1.0;
      stopLoss = +(entry - slDist).toFixed(2);
      takeProfit = +Math.min(bbMid, entry + slDist * 1.5).toFixed(2);
      riskReward = +((takeProfit - entry) / slDist).toFixed(2);
    } else if (tagUpper && rsi > 68 && bearCandle) {
      playbook = "MEAN_REVERSION";
      type = "SELL";
      const slDist = atr * 1.0;
      stopLoss = +(entry + slDist).toFixed(2);
      takeProfit = +Math.max(bbMid, entry - slDist * 1.5).toFixed(2);
      riskReward = +((entry - takeProfit) / slDist).toFixed(2);
    } else {
      skipReason = "Range regime — waiting for BB outer-band tag + RSI extreme";
    }
  }
  // ---------- Skip ----------
  else {
    if (regime === "CHOP")
      skipReason = `Choppy regime (ADX ${adx.toFixed(0)}) — no edge, stand aside`;
    else if (!sessionOk) skipReason = `Outside kill zones (${session})`;
    else if (htfBias === "FLAT") skipReason = `H4 (${h4Trend}) and D1 (${d1Trend}) not aligned`;
  }

  // Confidence scoring (research: confluence-based)
  let confidence = 50;
  if (type !== "NEUTRAL") {
    confidence = 55;
    if (playbook === "TREND_PULLBACK") {
      confidence += 10; // base for trend playbook
      if (adx >= 28) confidence += 6; // strong trend
      if (h4Trend === d1Trend) confidence += 6;
      if (dxyOk) confidence += 5;
      if (session === "OVERLAP") confidence += 4;
    } else if (playbook === "MEAN_REVERSION") {
      confidence += 6;
      if (adx < 18) confidence += 5;
      if (rsi > 75 || rsi < 25) confidence += 6;
      if (session !== "ASIA") confidence += 3;
    }
  }
  confidence = Math.min(88, confidence);

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
    session,
    sessionOk,
    dxyOk,
    rsi,
    macd,
    ema20v,
    ema50v,
    ema200v,
    atr,
    adx,
    bbUpper,
    bbLower,
    bbMid,
    regime,
    skipReason,
    htfBias,
  };
}

// =============== backtest ===============
function backtest(candles: Candle[], alignedDxyTrends: Trend[]) {
  const trades: HistoryItem[] = [];
  const rs: number[] = [];
  let wins = 0,
    totalR = 0,
    grossWin = 0,
    grossLoss = 0;
  let equity = 0,
    peak = 0,
    maxDD = 0;
  const splitIdx = Math.floor(candles.length * 0.7);
  let inSampleR = 0,
    outSampleR = 0;
  let i = EMA_SLOW_PERIOD;
  while (i < candles.length - 1) {
    const ev = evaluateAt(candles, i, alignedDxyTrends[i] ?? "FLAT");
    if (!ev || ev.type === "NEUTRAL") {
      i++;
      continue;
    }
    let exitIdx = -1,
      win = false;
    for (let j = i + 1; j < Math.min(i + BACKTEST_MAX_HOLD_BARS, candles.length); j++) {
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
    } else {
      grossLoss += 1;
    }
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
  // Sharpe / Sortino on per-trade R
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

      const alignedDxyTrends = alignDxyTrends(candles, dxyCandles);
      const dxySnapshot = buildDxySnapshots(dxyCandles).latest;
      const dxyTrend = alignedDxyTrends.at(-1) ?? "FLAT";

      const ev = evaluateAt(candles, candles.length - 1, dxyTrend)!;
      const bt = backtest(candles, alignedDxyTrends);

      const checks = [
        ev.regime !== "CHOP",
        ev.sessionOk,
        ev.regime === "TREND" ? ev.h4Trend === ev.d1Trend && ev.h4Trend !== "FLAT" : ev.adx < 20,
        ev.dxyOk,
      ];
      const passed = checks.filter(Boolean).length;

      const macdLabel = ev.macd > 0 ? "Bullish" : "Bearish";
      const rsiLabel = ev.rsi > 70 ? "Overbought" : ev.rsi < 30 ? "Oversold" : "Neutral";

      const rationale =
        ev.type === "NEUTRAL"
          ? `Stand aside — ${ev.skipReason}. Quality > frequency.`
          : ev.playbook === "TREND_PULLBACK"
            ? `${ev.type} via Trend Pullback: ADX ${ev.adx.toFixed(0)} (trending), H4+D1 ${ev.htfBias}, price retraced to EMA20/50 zone, RSI rotating ${ev.rsi.toFixed(0)}, ${ev.session} session. Stop 1.5×ATR, target 1:2 R:R.`
            : `${ev.type} via Mean Reversion: ADX ${ev.adx.toFixed(0)} (range), price tagged ${ev.type === "BUY" ? "lower" : "upper"} BB(20,2), RSI extreme ${ev.rsi.toFixed(0)}. Stop 1×ATR, target BB mid.`;

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
          bbUpper: +ev.bbUpper.toFixed(2),
          bbLower: +ev.bbLower.toFixed(2),
          bbMid: +ev.bbMid.toFixed(2),
        },
        confluence: {
          regime: ev.regime,
          adx: +ev.adx.toFixed(1),
          h4Trend: ev.h4Trend,
          d1Trend: ev.d1Trend,
          session: ev.session,
          sessionOk: ev.sessionOk,
          dxyTrend,
          dxyOk: ev.dxyOk,
          passed,
          total: 4,
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
          name: "Adaptive Hybrid: Trend-Pullback + Mean-Reversion",
          version: "v3.1",
          notes:
            "ADX-gated regime switch. Trending (ADX≥22): MTF-aligned EMA pullback, 1.5×ATR stop, 1:2 RR. Range (ADX<20): BB(20,2) outer-band tag + RSI extreme reversion to mid. Kill-zone sessions only. Backtest uses a fixed-rule 70/30 sample split with time-aligned DXY context.",
        },
        fetchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
    }
  },
);
