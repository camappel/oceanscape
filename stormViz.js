/**
 * Canvas time-series for storm score inputs.
 * Strip-chart layout: one horizontal lane per variable, full series on the X axis + vertical playhead.
 * No Tone.js — plain canvas + numeric snapshots from main.js.
 */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Storm row keys (0–1 assumed). */
const STORM_SERIES = [
  { key: "water_level", label: "water", color: "#7dd3fc" },
  { key: "residual", label: "residual", color: "#a78bfa" },
  { key: "storm_energy", label: "energy", color: "#f472b6" },
  { key: "pressure_low", label: "pressure↓", color: "#94a3b8" },
  { key: "wind", label: "wind", color: "#34d399" },
  { key: "gust", label: "gust", color: "#fb923c" },
  { key: "rhythm_density", label: "rhythm", color: "#fde047" },
];

/**
 * @typedef {Object} NormRanges
 * @property {[number, number]} filterHz
 * @property {[number, number]} delayFeedback
 * @property {[number, number]} noiseGain
 * @property {[number, number]} velocity
 */

/**
 * @typedef {Object} StormVizSnapshot
 * @property {object[]} stormData
 * @property {number} lastPlayedIndex
 * @property {object} [lastRow]
 * @property {object} [lastControls]
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ normRanges: NormRanges, onPlayheadChange?: (index: number, n: number) => void }} options
 */
export function createStormViz(canvas, options) {
  const onPlayheadChange = options.onPlayheadChange;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Storm viz: 2d context unavailable");

  /** @type {StormVizSnapshot | null} */
  let lastSnapshot = null;

  const layout = {
    headerH: 26,
    footerH: 22,
    labelColW: 108,
    marginR: 10,
  };

  function cssSize() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth || canvas.width;
    const h = rect.height || canvas.clientHeight || canvas.height;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function syncCanvasPixels() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { w, h } = cssSize();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr };
  }

  function stormValue(row, key) {
    const v = row?.[key];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v, 0, 1) : 0;
  }

  function notifyPlayheadReset() {
    onPlayheadChange?.(-1, 0);
  }

  function notifyPlayheadActive(index, n) {
    onPlayheadChange?.(index, n);
  }

  function drawIdle(w, h) {
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#64748b";
    ctx.font = "14px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Press Start — time series will track playback", w / 2, h / 2);
  }

  function draw() {
    const { w, h } = syncCanvasPixels();
    ctx.fillStyle = "#101722";
    ctx.fillRect(0, 0, w, h);

    if (!lastSnapshot || lastSnapshot.lastPlayedIndex < 0 || !lastSnapshot.stormData?.length) {
      notifyPlayheadReset();
      drawIdle(w, h);
      return;
    }

    const { stormData, lastPlayedIndex, lastRow } = lastSnapshot;
    const n = stormData.length;
    const plotLeft = layout.labelColW;
    const plotRight = w - layout.marginR;
    const plotW = Math.max(1, plotRight - plotLeft);

    const xFor = (idx) => {
      if (n <= 1) return plotLeft + plotW * 0.5;
      return plotLeft + (idx / (n - 1)) * plotW;
    };

    const innerTop = layout.headerH;
    const innerBottom = h - layout.footerH;
    const innerH = Math.max(1, innerBottom - innerTop);
    const dividerH = 14;
    const sectionHeaderCount = 1;
    const titleBand = dividerH * sectionHeaderCount;
    const laneCount = STORM_SERIES.length;
    const laneH = Math.max(12, (innerH - titleBand) / laneCount);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("Storm inputs (full series + playhead)", 8, 17);

    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(lastRow?.time ? `now: ${lastRow.time}` : "", plotRight, 17);
    ctx.textAlign = "left";

    let y = innerTop;

    function drawSectionTitle(text) {
      ctx.fillStyle = "#64748b";
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 8, y + dividerH * 0.5);
      ctx.textBaseline = "alphabetic";
      y += dividerH;
    }

    /**
     * @param {typeof STORM_SERIES[0]} series
     * @param {(i: number) => number | null} getV01
     * @param {number} indexLo inclusive
     * @param {number} indexHi inclusive
     * @param {number} dotIndex index for playhead highlight dot
     */
    function drawLane(series, getV01, indexLo, indexHi, dotIndex) {
      const yTop = y;
      const yBottom = yTop + laneH;
      const vPad = 3;
      const vScale = Math.max(1, laneH - vPad * 2);

      ctx.fillStyle = "rgba(15,23,42,0.45)";
      ctx.fillRect(0, yTop, w, laneH);

      ctx.strokeStyle = "rgba(51,65,85,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yBottom);
      ctx.lineTo(w, yBottom);
      ctx.stroke();

      ctx.fillStyle = "#94a3b8";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(series.label, plotLeft - 8, yTop + laneH * 0.5);
      ctx.textAlign = "left";

      ctx.strokeStyle = "rgba(148,163,184,0.14)";
      ctx.lineWidth = 1;
      for (const t of [0, 0.5, 1]) {
        const yy = yBottom - vPad - t * vScale;
        ctx.beginPath();
        ctx.moveTo(plotLeft, yy);
        ctx.lineTo(plotRight, yy);
        ctx.stroke();
      }

      ctx.strokeStyle = series.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let started = false;
      const lo = Math.max(0, Math.min(indexLo, indexHi));
      const hi = Math.max(0, Math.max(indexLo, indexHi));
      for (let i = lo; i <= hi; i += 1) {
        const v = getV01(i);
        if (v === null || Number.isNaN(v)) {
          started = false;
          continue;
        }
        const x = xFor(i);
        const yy = yBottom - vPad - clamp(v, 0, 1) * vScale;
        if (!started) {
          ctx.moveTo(x, yy);
          started = true;
        } else {
          ctx.lineTo(x, yy);
        }
      }
      ctx.stroke();

      const px = xFor(dotIndex);
      const lastV = getV01(dotIndex);
      if (lastV !== null && Number.isFinite(lastV)) {
        const yy = yBottom - vPad - clamp(lastV, 0, 1) * vScale;
        ctx.fillStyle = series.color;
        ctx.beginPath();
        ctx.arc(px, yy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = "rgba(248,250,252,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotRight, yTop);
      ctx.lineTo(plotRight, yBottom);
      ctx.stroke();

      y += laneH;
    }

    drawSectionTitle("Storm inputs (0-1)");
    for (const s of STORM_SERIES) {
      drawLane(
        s,
        (i) => {
          const row = stormData[i];
          if (!row) return null;
          return stormValue(row, s.key);
        },
        0,
        n - 1,
        lastPlayedIndex
      );
    }

    const playX = clamp(xFor(lastPlayedIndex), plotLeft, plotRight);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.88)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playX, innerTop);
    ctx.lineTo(playX, innerBottom);
    ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${n} rows · playhead index ${lastPlayedIndex}`, w / 2, h - 7);

    notifyPlayheadActive(lastPlayedIndex, n);
  }

  function onResize() {
    if (!lastSnapshot) {
      const { w, h } = syncCanvasPixels();
      notifyPlayheadReset();
      drawIdle(w, h);
      return;
    }
    draw();
  }
  window.addEventListener("resize", onResize);

  return {
    /**
     * @param {StormVizSnapshot} snapshot
     */
    update(snapshot) {
      lastSnapshot = snapshot;
      draw();
    },

    freeze() {
      draw();
    },

    clear() {
      lastSnapshot = null;
      const { w, h } = syncCanvasPixels();
      notifyPlayheadReset();
      drawIdle(w, h);
    },

    destroy() {
      window.removeEventListener("resize", onResize);
    },
  };
}
