import { createStormViz } from "./stormViz.js";

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

const MUSIC = {
  stepSeconds: 0.2,
  masterGain: 0.34,
  filterMinHz: 260,
  filterMaxHz: 2100,
  pad: {
    volumeDb: -10,
    attack: 0.9,
    decay: 1.8,
    sustain: 0.56,
    release: 3.8,
  },
  windNoise: {
    minGain: 0.003,
    maxGain: 0.06,
  },
  ornament: {
    probMin: 0.1,
    probFromEnergy: 0.34,
    probFromGust: 0.22,
    probFromRhythm: 0.26,
    probFromWave: 0.2,
    probMax: 0.94,
    phraseMinNotes: 2,
    phraseMaxNotes: 4,
    baseSpacing: 0.11,
    spacingJitter: 0.09,
    gustSpacingTrim: 0.04,
    noteLengthBase: 0.2,
    noteLengthJitter: 0.14,
    velocityMin: 0.18,
    velocityMax: 0.68,
    neighborStepChance: 0.78,
    upperBiasBase: 0.28,
    upperBiasFromWave: 0.24,
    restChance: 0.18,
    graceNoteChance: 0.32,
    swingAmount: 0.36,
    downbeatAccent: 0.12,
    octaveDropChance: 0.24,
    startOnRootChance: 0.58,
    endOnRootChance: 0.72,
  },
  ornamentSynth: {
    oscillator: "sawtooth",
    attack: 0.03,
    decay: 0.35,
    sustain: 0.5,
    release: 0.65,
    volumeDb: -14,
    maxPolyphony: 6,
    filterQ: 3.6,
    filterAttack: 0.01,
    filterDecay: 0.22,
    filterSustain: 0.42,
    filterRelease: 0.35,
    filterBaseHz: 420,
    filterOctaves: 3.2,
  },
};

const MODE_STATE_BY_ROOT = {
  D: {
    root: "D",
    bass: ["D2", "A2", "D3"],
    scale: ["D4", "E4", "F4", "A4", "C5"],
  },
  F: {
    root: "F",
    bass: ["F2", "C3", "F3"],
    scale: ["F4", "G4", "A4", "C5", "D5"],
  },
  G: {
    root: "G",
    bass: ["G2", "D3", "G3"],
    scale: ["G4", "A4", "D5", "F5"],
  },
  A: {
    root: "A",
    bass: ["A2", "E3", "A3"],
    scale: ["A4", "C5", "D5", "E5", "G5"],
  },
};

let stormData = [];
let i = 0;
let isPlaying = false;
let repeatEventId = null;
let ornamentBusyUntil = 0;
/** @type {ReturnType<typeof createToneGraph> | null} */
let graph = null;

const stormViz = createStormViz(document.getElementById("viz"), {
  normRanges: {
    filterHz: [MUSIC.filterMinHz, MUSIC.filterMaxHz],
    delayFeedback: [0.08, 0.52],
    noiseGain: [MUSIC.windNoise.minGain, MUSIC.windNoise.maxGain],
    velocity: [0.2, 0.8],
  },
});
stormViz.clear();

document.getElementById("startBtn").onclick = start;

const decisionEls = {
  bass: document.getElementById("decBass"),
  horn: document.getElementById("decHorn"),
  hornNote: document.getElementById("decHornNote"),
  percCrash: document.getElementById("decPercCrash"),
};
const probEls = {
  hornFill: document.getElementById("probHornFill"),
  hornVal: document.getElementById("probHornVal"),
  percFill: document.getElementById("probPercFill"),
  percVal: document.getElementById("probPercVal"),
  crashFill: document.getElementById("probCrashFill"),
  crashVal: document.getElementById("probCrashVal"),
};
const modeReasonEls = {
  waterVal: document.getElementById("modeWaterVal"),
  ruleText: document.getElementById("modeRuleText"),
  marker: document.getElementById("modeWaterMarker"),
  bandD: document.getElementById("modeBandD"),
  bandF: document.getElementById("modeBandF"),
  bandG: document.getElementById("modeBandG"),
  bandA: document.getElementById("modeBandA"),
};

function setDecisionText(el, text) {
  if (el) el.textContent = text;
}

function setProb(probFillEl, probValEl, value01) {
  const v = clamp(value01 ?? 0, 0, 1);
  if (probFillEl) probFillEl.style.width = `${(v * 100).toFixed(1)}%`;
  if (probValEl) probValEl.textContent = `${Math.round(v * 100)}%`;
}

function modeReasonFromWater(waterLevel) {
  const water = clamp(waterLevel ?? 0, 0, 1);
  if (water < 0.25) return { root: "D", rule: "water < 0.25", water };
  if (water < 0.5) return { root: "F", rule: "0.25 <= water < 0.50", water };
  if (water < 0.75) return { root: "G", rule: "0.50 <= water < 0.75", water };
  return { root: "A", rule: "water >= 0.75", water };
}

function percCrashDecisionLabel(percTriggered, crashTriggered) {
  if (!percTriggered && !crashTriggered) return "No hit";
  if (percTriggered && crashTriggered) return "Percussion + crash";
  if (percTriggered) return "Percussion";
  return "Crash";
}

function resetDecisionViz() {
  setDecisionText(decisionEls.bass, "-");
  setDecisionText(decisionEls.horn, "-");
  setDecisionText(decisionEls.hornNote, "-");
  setDecisionText(decisionEls.percCrash, "-");
}

function updateDecisionViz({ mode, ornamentTriggered, ornamentAnchor, percTriggered, crashTriggered }) {
  setDecisionText(decisionEls.bass, mode.bass.join(" - "));
  setDecisionText(decisionEls.horn, ornamentTriggered ? "Phrase" : "No phrase");
  setDecisionText(decisionEls.hornNote, ornamentAnchor ?? "-");
  setDecisionText(decisionEls.percCrash, percCrashDecisionLabel(percTriggered, crashTriggered));
}

function resetProbabilityViz() {
  setProb(probEls.hornFill, probEls.hornVal, 0);
  setProb(probEls.percFill, probEls.percVal, 0);
  setProb(probEls.crashFill, probEls.crashVal, 0);
}

function updateProbabilityViz(controls) {
  setProb(probEls.hornFill, probEls.hornVal, controls.ornamentProbability);
  setProb(probEls.percFill, probEls.percVal, controls.percProbability);
  setProb(probEls.crashFill, probEls.crashVal, controls.crashProbability);
}

function setModeBandActive(root) {
  for (const bandEl of [modeReasonEls.bandD, modeReasonEls.bandF, modeReasonEls.bandG, modeReasonEls.bandA]) {
    if (bandEl) bandEl.classList.remove("active");
  }
  if (root === "D" && modeReasonEls.bandD) modeReasonEls.bandD.classList.add("active");
  if (root === "F" && modeReasonEls.bandF) modeReasonEls.bandF.classList.add("active");
  if (root === "G" && modeReasonEls.bandG) modeReasonEls.bandG.classList.add("active");
  if (root === "A" && modeReasonEls.bandA) modeReasonEls.bandA.classList.add("active");
}

function resetModeReasonViz() {
  setDecisionText(modeReasonEls.waterVal, "-");
  setDecisionText(modeReasonEls.ruleText, "-");
  if (modeReasonEls.marker) modeReasonEls.marker.style.left = "0%";
  setModeBandActive("");
}

function updateModeReasonViz(waterLevel) {
  const reason = modeReasonFromWater(waterLevel);
  setDecisionText(modeReasonEls.waterVal, reason.water.toFixed(3));
  setDecisionText(modeReasonEls.ruleText, `${reason.rule} -> root ${reason.root}`);
  if (modeReasonEls.marker) modeReasonEls.marker.style.left = `${(reason.water * 100).toFixed(1)}%`;
  setModeBandActive(reason.root);
}

resetDecisionViz();
resetProbabilityViz();
resetModeReasonViz();

function getModeState(waterLevel) {
  const reason = modeReasonFromWater(waterLevel);
  return MODE_STATE_BY_ROOT[reason.root];
}

function controlsFromRow(row) {
  const energy = row.storm_energy ?? 0;
  const wind = row.wind ?? 0;
  const pressureLow = row.pressure_low ?? 0.5;
  const rhythm = row.rhythm_density ?? 0;
  const gust = row.gust ?? 0;
  const waveH = row.wave_height ?? 0;
  const waveP = row.wave_power ?? 0;
  const O = MUSIC.ornament;

  const brightness = clamp(0.22 + energy * 0.56 + wind * 0.2 - pressureLow * 0.24, 0, 1);
  const filterHz = clamp(
    MUSIC.filterMinHz + brightness * (MUSIC.filterMaxHz - MUSIC.filterMinHz),
    MUSIC.filterMinHz,
    MUSIC.filterMaxHz
  );

  return {
    filterHz,
    filterNorm: brightness,
    distortionWet: clamp(energy * 0.45, 0, 0.5),
    delayFeedback: clamp(0.12 + wind * 0.32, 0.08, 0.52),
    noiseGain: clamp(
      MUSIC.windNoise.minGain + wind * (MUSIC.windNoise.maxGain - MUSIC.windNoise.minGain),
      MUSIC.windNoise.minGain,
      MUSIC.windNoise.maxGain
    ),
    padVelocity: clamp(0.24 + energy * 0.24, 0.2, 0.72),
    velocity: clamp(0.24 + energy * 0.24, 0.2, 0.72),
    ornamentProbability: clamp(
      O.probMin +
        energy * O.probFromEnergy +
        gust * O.probFromGust +
        rhythm * O.probFromRhythm +
        waveP * O.probFromWave,
      O.probMin,
      O.probMax
    ),
    percProbability: clamp(0.16 + rhythm * 0.5 + waveP * 0.24, 0.16, 0.95),
    crashProbability: clamp(0.14 + gust * 0.62, 0.14, 0.95),
    waveAccent: clamp((waveH + waveP) * 0.5, 0, 1),
  };
}

function chooseOrnamentAnchorIndex(scale, controls) {
  const O = MUSIC.ornament;
  const minStart = clamp(
    Math.floor(scale.length * (O.upperBiasBase + controls.waveAccent * O.upperBiasFromWave)),
    0,
    Math.max(0, scale.length - 1)
  );
  return minStart + Math.floor(Math.random() * Math.max(1, scale.length - minStart));
}

function rootIndexesForScale(scale, modeRoot) {
  if (!Array.isArray(scale)) return [];
  return scale
    .map((note, idx) => ({ note, idx }))
    .filter((entry) => typeof entry.note === "string" && entry.note.startsWith(modeRoot))
    .map((entry) => entry.idx);
}

function maybeTriggerOrnament(time, row, mode, controls) {
  if (!graph) return { triggered: false, anchor: "-" };
  if (time < ornamentBusyUntil) return { triggered: false, anchor: "-" };
  if (Math.random() >= controls.ornamentProbability) return { triggered: false, anchor: "-" };
  if (!Array.isArray(mode.scale) || mode.scale.length === 0) return { triggered: false, anchor: "-" };

  const O = MUSIC.ornament;
  const rhythm = clamp(row.rhythm_density ?? 0, 0, 1);
  const gust = clamp(row.gust ?? 0, 0, 1);
  const noteSpan = O.phraseMaxNotes - O.phraseMinNotes + 1;
  const targetCount = clamp(
    O.phraseMinNotes + Math.floor(Math.random() * noteSpan) + (rhythm > 0.72 ? 1 : 0),
    O.phraseMinNotes,
    O.phraseMaxNotes
  );
  const rootIdxs = rootIndexesForScale(mode.scale, mode.root);
  const hasRoot = rootIdxs.length > 0;
  const forceStartOnRoot = hasRoot && Math.random() < O.startOnRootChance;
  const forceEndOnRoot = hasRoot && Math.random() < O.endOnRootChance;
  const randomRootIdx = () => rootIdxs[Math.floor(Math.random() * rootIdxs.length)];

  let noteIdx = chooseOrnamentAnchorIndex(mode.scale, controls);
  if (forceStartOnRoot) {
    noteIdx = randomRootIdx();
  }
  let anchor = mode.scale[noteIdx];


  let phraseEnd = time;
  for (let n = 0; n < targetCount; n += 1) {
    const isLastSlot = n === targetCount - 1;
    if (isLastSlot && forceEndOnRoot) {
      noteIdx = randomRootIdx();
    } else if (n > 0 && Math.random() < O.restChance) {
      continue;
    }
    if (!(isLastSlot && forceEndOnRoot) && n > 0 && Math.random() < O.neighborStepChance) {
      const direction = Math.random() < 0.5 ? -1 : 1;
      noteIdx = clamp(noteIdx + direction, 0, mode.scale.length - 1);
    }
    let note = mode.scale[noteIdx];
    if (Math.random() < O.octaveDropChance) {
      note = Tone.Frequency(note).transpose(-12).toNote();
    }
    const spacing = Math.max(0.02, O.baseSpacing + Math.random() * O.spacingJitter - gust * O.gustSpacingTrim);
    const swingOffset = n % 2 === 1 ? spacing * O.swingAmount : 0;
    const noteTime = time + n * spacing + swingOffset;
    const noteLength = Math.max(
      0.1,
      O.noteLengthBase + Math.random() * O.noteLengthJitter + spacing * 0.95 - controls.waveAccent * 0.02
    );
    if (n > 0 && Math.random() < O.graceNoteChance) {
      const graceDirection = Math.random() < 0.5 ? -1 : 1;
      const grace = Tone.Frequency(note).transpose(graceDirection).toNote();
      graph.ornament.triggerAttackRelease(grace, 0.035, Math.max(time, noteTime - 0.04), O.velocityMin + 0.06);
    }
    const vel = clamp(
      O.velocityMin +
        (O.velocityMax - O.velocityMin) *
          (0.26 + controls.waveAccent * 0.34 + Math.random() * 0.28 + (n === 0 ? O.downbeatAccent : 0)),
      O.velocityMin,
      O.velocityMax
    );
    graph.ornament.triggerAttackRelease(note, noteLength, noteTime, vel);
    phraseEnd = Math.max(phraseEnd, noteTime + noteLength);
  }

  ornamentBusyUntil = phraseEnd + 0.04;
  return { triggered: true, anchor };
}

function maybeTriggerPercussion(time, row, controls) {
  if (!graph) return { perc: false, crash: false };

  let perc = false;
  let crash = false;

  if (Math.random() < controls.percProbability) {
    perc = true;
    const water = row.water_level ?? 0;
    const wave = controls.waveAccent;
    const baseMidi = 40 + Math.floor(water * 8);
    const percNote = Tone.Frequency(baseMidi + Math.floor(Math.random() * 3), "midi").toNote();
    graph.perc.triggerAttackRelease(percNote, "16n", time, clamp(0.4 + wave * 0.5, 0.35, 1));

    if (Math.random() < 0.5 + wave * 0.45) {
      graph.wavePulse.triggerAttackRelease("C4", "32n", time + 0.04, clamp(0.22 + wave * 0.28, 0.18, 0.7));
    }
  }

  if (Math.random() < controls.crashProbability) {
    crash = true;
    graph.crash.triggerAttackRelease("8n", time, clamp(0.35 + (row.gust ?? 0) * 0.65, 0.32, 1));
  }

  return { perc, crash };
}

function createToneGraph() {
  const master = new Tone.Gain(MUSIC.masterGain);
  master.toDestination();

  const reverb = new Tone.Reverb({ decay: 10, wet: 0.82 }).connect(master);
  const delay = new Tone.FeedbackDelay({ delayTime: 0.6, feedback: 0.22, wet: 0.2 }).connect(master);
  const drive = new Tone.Distortion({ distortion: 0.25, wet: 0.1 }).connect(delay);
  const filter = new Tone.Filter({ type: "lowpass", frequency: 720, rolloff: -12, Q: 0.45 }).connect(drive);
  const verbSend = new Tone.Gain(0.23).connect(reverb);

  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: {
      attack: MUSIC.pad.attack,
      decay: MUSIC.pad.decay,
      sustain: MUSIC.pad.sustain,
      release: MUSIC.pad.release,
    },
    volume: MUSIC.pad.volumeDb,
  });
  pad.connect(filter);
  pad.connect(verbSend);

  const perc = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 2.2,
    envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.08 },
    volume: -12,
  }).connect(master);

  const crash = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.28 },
    volume: -16,
  }).connect(master);

  const wavePulse = new Tone.Synth({
    oscillator: { type: "sine" },
    envelope: { attack: 0.005, decay: 0.08, sustain: 0, release: 0.08 },
    volume: -20,
  });
  wavePulse.connect(filter);
  wavePulse.connect(verbSend);

  const ornament = new Tone.PolySynth(Tone.MonoSynth, {
    maxPolyphony: MUSIC.ornamentSynth.maxPolyphony,
    oscillator: { type: MUSIC.ornamentSynth.oscillator },
    envelope: {
      attack: MUSIC.ornamentSynth.attack,
      decay: MUSIC.ornamentSynth.decay,
      sustain: MUSIC.ornamentSynth.sustain,
      release: MUSIC.ornamentSynth.release,
    },
    filter: {
      Q: MUSIC.ornamentSynth.filterQ,
      type: "lowpass",
      rolloff: -12,
    },
    filterEnvelope: {
      attack: MUSIC.ornamentSynth.filterAttack,
      decay: MUSIC.ornamentSynth.filterDecay,
      sustain: MUSIC.ornamentSynth.filterSustain,
      release: MUSIC.ornamentSynth.filterRelease,
      baseFrequency: MUSIC.ornamentSynth.filterBaseHz,
      octaves: MUSIC.ornamentSynth.filterOctaves,
    },
    volume: MUSIC.ornamentSynth.volumeDb,
  });
  ornament.connect(filter);
  ornament.connect(verbSend);

  const windNoise = new Tone.Noise("pink").start();
  const noiseGain = new Tone.Gain(0.008).connect(master);
  windNoise.connect(noiseGain);

  return {
    master,
    reverb,
    delay,
    drive,
    filter,
    verbSend,
    pad,
    perc,
    crash,
    wavePulse,
    ornament,
    windNoise,
    noiseGain,
  };
}

function disposeGraph(g) {
  if (!g) return;
  g.windNoise.stop();
  g.pad.dispose();
  g.perc.dispose();
  g.crash.dispose();
  g.wavePulse.dispose();
  g.ornament.dispose();
  g.windNoise.dispose();
  g.noiseGain.dispose();
  g.filter.dispose();
  g.drive.dispose();
  g.delay.dispose();
  g.reverb.dispose();
  g.verbSend.dispose();
  g.master.dispose();
}

function stopPlaybackAsync(completed) {
  Tone.Transport.stop();
  if (repeatEventId !== null) {
    Tone.Transport.clear(repeatEventId);
    repeatEventId = null;
  }
  Tone.Transport.cancel();

  disposeGraph(graph);
  graph = null;
  isPlaying = false;
  ornamentBusyUntil = 0;

  const btn = document.getElementById("startBtn");
  btn.disabled = false;
  btn.textContent = "Start Modal Storm";

  if (completed) {
    stormViz.freeze();
  } else {
    stormViz.clear();
  }
  resetDecisionViz();
  resetProbabilityViz();
  resetModeReasonViz();
}

function stopPlayback(completed) {
  void stopPlaybackAsync(completed);
}

async function start() {
  const btn = document.getElementById("startBtn");
  if (isPlaying || btn.disabled) return;

  btn.disabled = true;
  btn.textContent = "Loading…";

  try {
    await Tone.start();
    const build =
      typeof window !== "undefined" && window.__AMBIENT_RELEASE__
        ? String(window.__AMBIENT_RELEASE__)
        : "";
    const scoreUrl = build ? `./storm_score.json?v=${encodeURIComponent(build)}` : "./storm_score.json";
    const json = await fetch(scoreUrl).then((r) => r.json());
    if (!Array.isArray(json) || json.length === 0) {
      throw new Error("storm_score.json must contain a non-empty array.");
    }

    stormData = json;
    i = 0;
    ornamentBusyUntil = 0;
    stormViz.clear();
    resetDecisionViz();
    resetProbabilityViz();
    resetModeReasonViz();

    Tone.Transport.stop();
    Tone.Transport.cancel();
    disposeGraph(graph);
    graph = createToneGraph();
    await graph.reverb.generate();

    isPlaying = true;
    repeatEventId = Tone.Transport.scheduleRepeat(onStep, MUSIC.stepSeconds);
    Tone.Transport.start("+0.05");
    btn.textContent = "Playing…";
  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = "Start Modal Storm";
    isPlaying = false;
  }
}

function onStep(time) {
  if (!graph || !isPlaying) return;

  if (i >= stormData.length) {
    stopPlayback(true);
    return;
  }

  const row = stormData[i];
  const mode = getModeState(row.water_level);
  const controls = controlsFromRow(row);
  const ornamentState = maybeTriggerOrnament(time, row, mode, controls);

  graph.pad.triggerAttackRelease(mode.bass, "1n", time, controls.padVelocity);
  graph.filter.frequency.rampTo(controls.filterHz, 0.16);
  graph.drive.wet.rampTo(controls.distortionWet, 0.12);
  graph.delay.feedback.rampTo(controls.delayFeedback, 0.15);
  graph.noiseGain.gain.rampTo(controls.noiseGain, 0.18);

  const { perc: percTriggered, crash: crashTriggered } = maybeTriggerPercussion(time, row, controls);
  updateDecisionViz({
    mode,
    ornamentTriggered: ornamentState.triggered,
    ornamentAnchor: ornamentState.anchor,
    percTriggered,
    crashTriggered,
  });
  updateProbabilityViz(controls);
  updateModeReasonViz(row.water_level);

  stormViz.update({
    stormData,
    lastPlayedIndex: i,
    lastRow: row,
    lastControls: {
      filterHz: controls.filterHz,
      delayFeedback: controls.delayFeedback,
      noiseGain: controls.noiseGain,
      velocity: controls.velocity,
      modeRoot: mode.root,
    },
  });

  i += 1;
}
