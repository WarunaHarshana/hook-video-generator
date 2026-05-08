const state = {
  project: null,
  thumbnails: [],
  activeJob: null,
  pollTimer: null,
  jobEvents: null,
  previewStopTimer: null,
  hookVideoSource: "output",
  pendingOutputAspectRatio: null,
  pendingAutoReframe: null,
  musicFileDuration: null,
};

const els = {
  statusPill: document.querySelector("#statusPill"),
  sourcePath: document.querySelector("#sourcePath"),
  chooseFileBtn: document.querySelector("#chooseFileBtn"),
  uploadStatus: document.querySelector("#uploadStatus"),
  clipDuration: document.querySelector("#clipDuration"),
  maxClips: document.querySelector("#maxClips"),
  sceneThreshold: document.querySelector("#sceneThreshold"),
  rangeStart: document.querySelector("#rangeStart"),
  rangeEnd: document.querySelector("#rangeEnd"),
  rangeStartNowBtn: document.querySelector("#rangeStartNowBtn"),
  rangeEndNowBtn: document.querySelector("#rangeEndNowBtn"),
  fullRangeBtn: document.querySelector("#fullRangeBtn"),
  rangeNote: document.querySelector("#rangeNote"),
  analyzeBtn: document.querySelector("#analyzeBtn"),
  cancelJobBtn: document.querySelector("#cancelJobBtn"),
  reloadBtn: document.querySelector("#reloadBtn"),
  progressPhase: document.querySelector("#progressPhase"),
  progressPercent: document.querySelector("#progressPercent"),
  progressFill: document.querySelector("#progressFill"),
  processNote: document.querySelector("#processNote"),
  metrics: document.querySelector("#metrics"),
  outputPath: document.querySelector("#outputPath"),
  chooseOutputBtn: document.querySelector("#chooseOutputBtn"),
  outputAspectRatio: document.querySelector("#outputAspectRatio"),
  effectPreset: document.querySelector("#effectPreset"),
  effectRecommendation: document.querySelector("#effectRecommendation"),
  colorEnhancement: document.querySelector("#colorEnhancement"),
  autoReframe: document.querySelector("#autoReframe"),
  musicPath: document.querySelector("#musicPath"),
  musicUrl: document.querySelector("#musicUrl"),
  chooseMusicBtn: document.querySelector("#chooseMusicBtn"),
  analyzeMusicBtn: document.querySelector("#analyzeMusicBtn"),
  removeMusicBtn: document.querySelector("#removeMusicBtn"),
  musicPreview: document.querySelector("#musicPreview"),
  analyzedMusicPreview: document.querySelector("#analyzedMusicPreview"),
  musicStart: document.querySelector("#musicStart"),
  musicDuration: document.querySelector("#musicDuration"),
  musicVolume: document.querySelector("#musicVolume"),
  sourceVolume: document.querySelector("#sourceVolume"),
  musicEnabled: document.querySelector("#musicEnabled"),
  muteSourceAudio: document.querySelector("#muteSourceAudio"),
  useEntireMusic: document.querySelector("#useEntireMusic"),
  beatSyncEnabled: document.querySelector("#beatSyncEnabled"),
  beatSyncIntensity: document.querySelector("#beatSyncIntensity"),
  beatEditEnergy: document.querySelector("#beatEditEnergy"),
  musicDirector: document.querySelector("#musicDirector"),
  beatTimeline: document.querySelector("#beatTimeline"),
  musicStatus: document.querySelector("#musicStatus"),
  musicProgressPhase: document.querySelector("#musicProgressPhase"),
  musicProgressPercent: document.querySelector("#musicProgressPercent"),
  musicProgressFill: document.querySelector("#musicProgressFill"),
  renderMode: document.querySelector("#renderMode"),
  glMode: document.querySelector("#glMode"),
  concurrency: document.querySelector("#concurrency"),
  renderTimeout: document.querySelector("#renderTimeout"),
  clearAfterRender: document.querySelector("#clearAfterRender"),
  clearWorkspaceBtn: document.querySelector("#clearWorkspaceBtn"),
  sourceVideo: document.querySelector("#sourceVideo"),
  outputVideo: document.querySelector("#outputVideo"),
  sourceMeta: document.querySelector("#sourceMeta"),
  outputMeta: document.querySelector("#outputMeta"),
  sourceFullscreenBtn: document.querySelector("#sourceFullscreenBtn"),
  outputFullscreenBtn: document.querySelector("#outputFullscreenBtn"),
  addHighlightBtn: document.querySelector("#addHighlightBtn"),
  previewHookBtn: document.querySelector("#previewHookBtn"),
  renderFinalBtn: document.querySelector("#renderFinalBtn"),
  saveProjectBtn: document.querySelector("#saveProjectBtn"),
  highlightRows: document.querySelector("#highlightRows"),
  titleText: document.querySelector("#titleText"),
};

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: {"content-type": "application/json"},
    ...options,
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
};

const seconds = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}s` : "-";
};

const formatTimecode = (value) => {
  const totalSeconds = Math.max(0, Number(value) || 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secondsPart = totalSeconds % 60;
  const secondsText =
    secondsPart % 1 === 0
      ? String(secondsPart).padStart(2, "0")
      : secondsPart.toFixed(2).padStart(5, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${secondsText}`;
  }

  return `${minutes}:${secondsText}`;
};

const parseTimeInput = (value, label, {allowBlank = false, fallback = 0} = {}) => {
  const text = String(value || "").trim();
  if (!text) {
    if (allowBlank) {
      return undefined;
    }

    return fallback;
  }

  if (!text.includes(":")) {
    const parsed = Number(text);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }

    throw new Error(`${label} must be seconds or a time like 1:23.`);
  }

  const parts = text.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => part === "")) {
    throw new Error(`${label} must use m:ss or h:mm:ss.`);
  }

  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`${label} must use numbers only.`);
  }

  const secondsPart = numbers.at(-1);
  const minutesPart = numbers.at(-2);
  if ((secondsPart ?? 0) >= 60 || (parts.length === 3 && (minutesPart ?? 0) >= 60)) {
    throw new Error(`${label} must use valid minutes and seconds.`);
  }

  return numbers.reduce((total, part) => total * 60 + part, 0);
};

const readAnalyzeRange = () => {
  const start = Math.max(0, parseTimeInput(els.rangeStart.value, "Analyze range start"));
  const endText = String(els.rangeEnd.value || "").trim();
  const end = parseTimeInput(els.rangeEnd.value, "Analyze range end", {allowBlank: true});

  if (endText && Number.isFinite(end) && end <= start) {
    throw new Error("Analyze range end must be greater than the start second.");
  }

  return {
    rangeStart: start,
    rangeEnd: Number.isFinite(end) ? end : undefined,
  };
};

const updateAnalyzeRangeNote = () => {
  try {
    const {rangeStart, rangeEnd} = readAnalyzeRange();
    if (rangeStart === 0 && !rangeEnd) {
      els.rangeNote.textContent = "Scanning the full video. You can type seconds or player time.";
      return;
    }

    const startLabel = `${formatTimecode(rangeStart)} = ${seconds(rangeStart)}`;
    const endLabel = Number.isFinite(rangeEnd)
      ? `${formatTimecode(rangeEnd)} = ${seconds(rangeEnd)}`
      : "the end";
    els.rangeNote.textContent = `Scanning ${startLabel} to ${endLabel}.`;
  } catch (error) {
    els.rangeNote.textContent = error.message;
  }
};

const setRangeTimeFromPlayer = (input) => {
  const currentTime = Number(els.sourceVideo.currentTime);
  if (!Number.isFinite(currentTime)) {
    els.rangeNote.textContent = "Load a source video before using the player time.";
    return;
  }

  input.value = formatTimecode(currentTime);
  updateAnalyzeRangeNote();
};

const sourceVideoExtensions = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
const audioOnlyExtensions = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg"]);
const musicMediaExtensions = new Set([
  ...audioOnlyExtensions,
  ...sourceVideoExtensions,
]);

const validateSourceVideoPath = (value) => {
  const path = String(value || "").trim();
  if (!path) {
    throw new Error("Choose a source video file first.");
  }

  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() || "";
  if (audioOnlyExtensions.has(extension)) {
    throw new Error(
      "That file is audio-only. Use the Music section for MP3/WAV/M4A files, and choose a video file as the source.",
    );
  }

  if (extension && !sourceVideoExtensions.has(extension)) {
    throw new Error("Choose a video source file: MP4, MOV, MKV, WEBM, AVI, or M4V.");
  }
};

const effectLabels = {
  clean: "Clean cuts",
  auto: "Auto director",
  "smooth-velocity": "Smooth velocity",
  "velocity-ramp": "Velocity ramp",
  "beat-bounce": "Beat bounce",
  "drop-whip": "Drop whip",
  "freeze-hit": "Freeze hit",
  "match-push": "Match push",
  "snap-zoom": "Snap zoom",
  "glitch-lite": "Glitch lite",
  "slow-fast-builder": "Slow-fast builder",
  "smooth-documentary": "Smooth documentary",
  "whip-cut": "Whip cut",
  "drop-burst": "Drop burst",
  "cinematic-ramp": "Cinematic ramp",
  "hard-beat-cuts": "Hard beat cuts",
  "smooth-slow": "Slow motion",
  "fast-kinetic": "Kinetic whip",
  "slow-fast-mix": "Slow-fast ramp",
  "beat-punch": "Beat punch",
  "flash-cuts": "Flash cuts",
  "impact-shake": "Impact shake",
};

const displayEffectPreset = (preset) => {
  return {
    "smooth-slow": "smooth-velocity",
    "smooth-documentary": "smooth-velocity",
    "fast-kinetic": "velocity-ramp",
    "whip-cut": "drop-whip",
    "drop-burst": "drop-whip",
    "slow-fast-mix": "slow-fast-builder",
    "cinematic-ramp": "slow-fast-builder",
    "flash-cuts": "match-push",
    "hard-beat-cuts": "match-push",
    "beat-punch": "beat-bounce",
    "impact-shake": "freeze-hit",
  }[preset] || preset || "clean";
};

const escapeHtml = (value) => {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
};

const highlightMetaSummary = (highlight) => {
  const metadata = highlight?.metadata;
  if (!metadata || typeof metadata !== "object") {
    return highlight?.reframe?.tracking === "face" ? "Focus face" : "";
  }

  const entries = [
    ["Energy", metadata.energyScore],
    ["Motion", metadata.motionScore],
    ["Scene", metadata.sceneScore],
    ["Dialogue", metadata.dialogueScore],
    ["Beat", metadata.spikeScore],
  ]
    .map(([label, value]) => ({label, value: Number(value)}))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, 2);

  if (!entries.length) {
    return highlight?.reframe?.tracking === "face" ? "Focus face" : "";
  }

  const signals = entries
    .map((item) => `${item.label} ${Math.round(item.value * 100)}`)
    .join(" · ");

  return highlight?.reframe?.tracking === "face" ? `${signals} · Focus face` : signals;
};

const getEffectRecommendation = (project = state.project) => {
  return project?.analysis?.effectRecommendation || null;
};

const renderEffectRecommendation = (project = state.project) => {
  const recommendation = getEffectRecommendation(project);

  if (!recommendation) {
    els.effectRecommendation.textContent =
      project?.highlights?.length
        ? "Analyze music to refine the effect recommendation."
        : "Analyze hooks to get an effect recommendation.";
    return;
  }

  const displayedPreset = displayEffectPreset(recommendation.preset);
  const label = effectLabels[displayedPreset] || effectLabels[recommendation.preset] || recommendation.preset;
  const source =
    recommendation.source === "video+music"
      ? "video and music"
      : recommendation.source || "video";
  const confidence = Math.round((Number(recommendation.confidence) || 0) * 100);
  const confidenceText = confidence > 0 ? ` (${confidence}%)` : "";
  els.effectRecommendation.innerHTML = `<strong>Recommended: ${escapeHtml(
    label,
  )}</strong>${confidenceText} from ${escapeHtml(source)} analysis. ${escapeHtml(
    recommendation.reason || "",
  )}`;
};

const applyRecommendedEffectToControls = (project = state.project) => {
  const recommendation = getEffectRecommendation(project);
  const displayedPreset = displayEffectPreset(recommendation?.preset);
  if (!recommendation?.preset || !effectLabels[displayedPreset]) {
    return false;
  }

  els.effectPreset.value = displayedPreset;
  if (state.project) {
    state.project = {
      ...state.project,
      effectPreset: displayedPreset,
    };
  }

  renderEffectRecommendation(state.project || project);
  return true;
};

const totalHighlightSeconds = () => {
  return (state.project?.highlights || []).reduce(
    (sum, highlight) => sum + Number(highlight.duration || 0),
    0,
  );
};

const beatSyncedDurationSeconds = (project = state.project) => {
  const baseDuration = (project?.highlights || []).reduce(
    (sum, highlight) => sum + Math.max(0, Number(highlight.duration) || 0),
    0,
  );
  const music = project?.music;

  if (
    !music?.enabled ||
    !music.beatSync?.enabled ||
    !Array.isArray(music.beats) ||
    music.beats.length < 2
  ) {
    return baseDuration;
  }

  return Math.min(baseDuration, Math.max(0.1, Number(music.duration) || baseDuration));
};

const setStatus = (text, className = "") => {
  els.statusPill.textContent = `Status: ${text}`;
  els.statusPill.className = `status-pill ${className}`.trim();
};

const isActiveJob = (job = state.activeJob) => {
  return Boolean(job && (job.status === "running" || job.status === "cancelling"));
};

const setBusy = (busy) => {
  const activeJob = isActiveJob();
  const cpuMode = els.renderMode.value === "cpu";
  els.analyzeBtn.disabled = busy;
  els.chooseFileBtn.disabled = busy;
  els.clipDuration.disabled = busy;
  els.maxClips.disabled = busy;
  els.sceneThreshold.disabled = busy;
  els.rangeStart.disabled = busy;
  els.rangeEnd.disabled = busy;
  els.rangeStartNowBtn.disabled = busy;
  els.rangeEndNowBtn.disabled = busy;
  els.fullRangeBtn.disabled = busy;
  els.chooseOutputBtn.disabled = busy;
  els.outputAspectRatio.disabled = busy;
  els.effectPreset.disabled = busy;
  els.colorEnhancement.disabled = busy;
  els.autoReframe.disabled = busy || els.outputAspectRatio.value === "source";
  els.chooseMusicBtn.disabled = busy;
  const hasMusicSource = Boolean(getMusicSource());
  els.analyzeMusicBtn.disabled = busy || !hasMusicSource;
  els.analyzeMusicBtn.title = !hasMusicSource
    ? "Choose a music file or enter a direct music URL"
    : !state.project
      ? "Analyze hooks before analyzing music"
      : "";
  els.removeMusicBtn.disabled = busy || !state.project?.music;
  els.useEntireMusic.disabled = busy || !hasMusicSource;
  els.musicStart.disabled = busy || !hasMusicSource || els.useEntireMusic.checked;
  els.musicDuration.disabled = busy || !hasMusicSource || els.useEntireMusic.checked;
  els.musicVolume.disabled = busy || !hasMusicSource;
  els.sourceVolume.disabled =
    busy || !hasMusicSource || !els.musicEnabled.checked || els.muteSourceAudio.checked;
  els.musicEnabled.disabled = busy || !hasMusicSource;
  els.muteSourceAudio.disabled = busy || !hasMusicSource || !els.musicEnabled.checked;
  const hasAnalyzedBeats = Boolean(state.project?.music?.beats?.length);
  els.beatSyncEnabled.disabled = busy || !hasMusicSource || !hasAnalyzedBeats;
  els.beatSyncIntensity.disabled =
    busy || !hasMusicSource || !hasAnalyzedBeats || !els.beatSyncEnabled.checked;
  els.beatEditEnergy.disabled =
    busy || !hasMusicSource || !hasAnalyzedBeats || !els.beatSyncEnabled.checked;
  els.renderMode.disabled = busy;
  els.glMode.disabled = busy || cpuMode;
  els.concurrency.disabled = busy;
  els.renderTimeout.disabled = busy;
  els.saveProjectBtn.disabled = busy || !state.project;
  els.previewHookBtn.disabled = busy || !state.project;
  els.renderFinalBtn.disabled = busy || !state.project;
  els.clearWorkspaceBtn.disabled = busy;
  els.clearAfterRender.disabled = busy;
  els.cancelJobBtn.hidden = !activeJob;
  els.cancelJobBtn.disabled = !activeJob || state.activeJob.status === "cancelling";
};

const setProgress = (progress = 0, phase = "Ready") => {
  const percent = Math.max(0, Math.min(Math.round(progress), 100));
  els.progressPhase.textContent = phase || "Ready";
  els.progressPercent.textContent = `${percent}%`;
  els.progressFill.style.width = `${percent}%`;
  els.processNote.textContent = phase || "Ready";
};

const setMusicProgress = (progress = 0, phase = "Music ready") => {
  const percent = Math.max(0, Math.min(Math.round(progress), 100));
  els.musicProgressPhase.textContent = phase || "Music ready";
  els.musicProgressPercent.textContent = `${percent}%`;
  els.musicProgressFill.style.width = `${percent}%`;
};

const setMusicNotice = (phase, message, progress = 0) => {
  setMusicProgress(progress, phase);
  els.musicStatus.textContent = message;
};

const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return "0 MB";
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const getSourceDimensions = (project = state.project) => {
  return {
    width: Math.max(1, Math.round(Number(project?.sourceWidth || project?.width || 1920))),
    height: Math.max(1, Math.round(Number(project?.sourceHeight || project?.height || 1080))),
  };
};

const dimensionsForAspect = (aspectRatio, project = state.project) => {
  const source = getSourceDimensions(project);

  if (aspectRatio === "9:16") {
    return {width: 1080, height: 1920};
  }

  if (aspectRatio === "1:1") {
    return {width: 1080, height: 1080};
  }

  if (aspectRatio === "4:5") {
    return {width: 1080, height: 1350};
  }

  if (aspectRatio === "16:9") {
    return {width: 1920, height: 1080};
  }

  return source;
};

const applyOutputFormatToProject = () => {
  if (!state.project) {
    return;
  }

  const outputAspectRatio = els.outputAspectRatio.value || "source";
  const dimensions = dimensionsForAspect(outputAspectRatio, state.project);
  const source = getSourceDimensions(state.project);

  state.project = {
    ...state.project,
    sourceWidth: source.width,
    sourceHeight: source.height,
    width: dimensions.width,
    height: dimensions.height,
    outputAspectRatio,
    reframeMode:
      outputAspectRatio === "source" || !els.autoReframe.checked ? "none" : "auto",
    colorEnhancement: els.colorEnhancement.value || "off",
    effectPreset: els.effectPreset.value || "clean",
  };
};

const getMusicSource = () => {
  return els.musicUrl.value.trim() || els.musicPath.value.trim();
};

const isRemoteMusicSource = (src) => /^(https?:|data:|blob:)/i.test(src);

const isYoutubeMusicSource = (src) => {
  try {
    const hostname = new URL(src).hostname.toLowerCase();
    return (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtu.be")
    );
  } catch {
    return false;
  }
};

const validateMusicSource = (value) => {
  const source = String(value || "").trim();
  if (!source) {
    throw new Error("Choose a music file or enter a direct music URL first.");
  }

  if (isYoutubeMusicSource(source)) {
    throw new Error(
      "YouTube links cannot be analyzed directly. Download the song first, then choose the local music file.",
    );
  }

  let pathname = source.split(/[?#]/)[0];
  if (isRemoteMusicSource(source)) {
    try {
      pathname = new URL(source).pathname;
    } catch {
      throw new Error("Enter a valid direct music file URL.");
    }
  }
  const extension = pathname.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() || "";
  if (extension && !musicMediaExtensions.has(extension)) {
    throw new Error(
      "Choose MP3, WAV, M4A, AAC, FLAC, OGG, or a video file that contains audio.",
    );
  }
};

const musicFromControls = () => {
  const src = getMusicSource();
  if (!src) {
    return undefined;
  }
  const existingMusic = state.project?.music || {};

  return {
    ...existingMusic,
    src,
    start: Math.max(0, Number(els.musicStart.value) || 0),
    duration: Math.max(0.1, Number(els.musicDuration.value) || totalHighlightSeconds() || 15),
    volume: Math.max(0, Math.min(Number(els.musicVolume.value) || 0, 1)),
    sourceVolume: Math.max(0, Math.min(Number(els.sourceVolume.value) || 0, 1)),
    muteSourceAudio: els.muteSourceAudio.checked,
    fadeSeconds: existingMusic.fadeSeconds ?? 1,
    loop: true,
    enabled: els.musicEnabled.checked,
    useEntireFile: els.useEntireMusic.checked,
    beatSync: {
      enabled: els.beatSyncEnabled.checked,
      intensity: els.beatSyncIntensity.value || "tight",
      editEnergy: els.beatEditEnergy.value || "balanced",
    },
  };
};

const knownMusicDuration = () => {
  const candidates = [
    state.musicFileDuration,
    state.project?.music?.detected?.audioDuration,
    els.musicPreview.duration,
    els.analyzedMusicPreview.duration,
  ];
  const duration = candidates.find(
    (value) => Number.isFinite(Number(value)) && Number(value) > 0,
  );

  return Number.isFinite(Number(duration)) ? Number(duration) : null;
};

const applyEntireMusicFile = () => {
  if (!els.useEntireMusic.checked) {
    return false;
  }

  els.musicStart.value = "0";
  const duration = knownMusicDuration();
  if (duration) {
    els.musicDuration.value = Number(duration.toFixed(3));
  }

  return Boolean(duration);
};

const applyMusicToProject = () => {
  if (!state.project) {
    return;
  }

  state.project = {
    ...state.project,
    music: musicFromControls(),
  };
};

const musicSummary = (music) => {
  if (!music?.src) {
    return "No music selected";
  }

  const score = Number(music.detected?.score);
  const scoreText = Number.isFinite(score) ? ` · score ${score.toFixed(2)}` : "";
  const beatCount = Number(music.detected?.beatCount);
  const beatsText = Number.isFinite(beatCount) && beatCount > 0
    ? ` · ${beatCount} beat${beatCount === 1 ? "" : "s"}`
    : "";
  const style = music.detected?.suggestedBeatStyle || music.beatSync?.intensity;
  const styleText = style ? ` · ${style} style` : "";
  const energy = music.detected?.suggestedEditEnergy || music.beatSync?.editEnergy;
  const energyText = energy ? ` · ${energy} energy` : "";
  const confidence = Number(music.detected?.analysisConfidence);
  const confidenceText = Number.isFinite(confidence)
    ? ` · ${Math.round(confidence * 100)}% confidence`
    : "";
  const plan = music.editPlan;
  const planText = plan
    ? ` · ${plan.energyCurve || "steady"} · ${plan.cutPoints?.length || 0} cuts`
    : "";
  const sourceAudioText = music.muteSourceAudio ? " · source muted" : "";
  return `${seconds(music.start)} to ${seconds(music.start + music.duration)}${scoreText}${beatsText}${styleText}${energyText}${confidenceText}${planText}${sourceAudioText}`;
};

const musicDirectorSummary = (music) => {
  const plan = music?.editPlan;

  if (!plan) {
    return "Analyze music to build a cut and effects plan.";
  }

  const sections = plan.sections || [];
  const sectionText = sections.length
    ? sections.map((section) => section.type).join(" → ")
    : "sections pending";
  const tempo = plan.tempo || "medium";
  const curve = plan.energyCurve || "steady";
  const energy = music.detected?.suggestedEditEnergy || music.beatSync?.editEnergy || "balanced";
  const cutCount = plan.cutPoints?.length || 0;
  const eventCount = plan.effectEvents?.length || 0;
  const confidence = Number(music.detected?.analysisConfidence);
  const confidenceText = Number.isFinite(confidence)
    ? ` Analysis confidence: ${Math.round(confidence * 100)}%.`
    : "";
  const strongBeatCount = Number(music.detected?.strongBeatCount);
  const strongBeatText = Number.isFinite(strongBeatCount) && strongBeatCount > 0
    ? ` Strong hits: ${strongBeatCount}.`
    : "";
  const roles = (plan.cutPoints || []).reduce((counts, cut) => {
    const role = cut.role || "beat";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const eventRoles = (plan.effectEvents || []).reduce((counts, event) => {
    const type = event.type || "pulse";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const roleText = Object.entries(roles)
    .filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} ${role}`)
    .join(", ");
  const eventText = Object.entries(eventRoles)
    .filter(([, count]) => count > 0)
    .slice(0, 5)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");

  return `Music Director: ${tempo} tempo, ${curve} curve, ${cutCount} cut points, ${eventCount} effect hits. Recommended energy: ${energy}.${confidenceText}${strongBeatText} ${sectionText}.${roleText ? ` Roles: ${roleText}.` : ""}${eventText ? ` Effects: ${eventText}.` : ""}`;
};

const renderBeatTimeline = (music) => {
  const plan = music?.editPlan;

  if (!plan || !els.beatTimeline) {
    els.beatTimeline.innerHTML = "";
    els.beatTimeline.hidden = true;
    return;
  }

  const duration = Math.max(0.1, Number(music.duration) || Number(plan.sections?.at(-1)?.end) || 0.1);
  const sections = plan.sections || [];
  const cuts = plan.cutPoints || [];
  const events = plan.effectEvents || [];
  const sectionBands = sections.map((section) => {
    const left = Math.max(0, Math.min(100, (Number(section.start) / duration) * 100));
    const width = Math.max(
      0.8,
      Math.min(100 - left, ((Number(section.end) - Number(section.start)) / duration) * 100),
    );
    return `<span class="timeline-section ${escapeHtml(section.type)}" style="left:${left}%;width:${width}%;" title="${escapeHtml(section.type)}"></span>`;
  }).join("");
  const cutMarks = cuts.slice(0, 140).map((cut) => {
    const left = Math.max(0, Math.min(100, (Number(cut.time) / duration) * 100));
    const role = cut.role || "beat";
    return `<span class="timeline-cut ${escapeHtml(role)}" style="left:${left}%;" title="${escapeHtml(role)} cut at ${seconds(cut.time)}"></span>`;
  }).join("");
  const eventMarks = events.slice(0, 160).map((event) => {
    const left = Math.max(0, Math.min(100, (Number(event.time) / duration) * 100));
    return `<span class="timeline-event ${escapeHtml(event.type)}" style="left:${left}%;" title="${escapeHtml(event.type)} effect at ${seconds(event.time)}"></span>`;
  }).join("");

  els.beatTimeline.hidden = false;
  els.beatTimeline.innerHTML = `
    <div class="timeline-head">
      <span>Beat edit timeline</span>
      <strong>${escapeHtml(music.beatSync?.editEnergy || "balanced")}</strong>
    </div>
    <div class="timeline-track">${sectionBands}${cutMarks}${eventMarks}</div>
    <div class="timeline-legend">
      <span><i class="beat"></i>Beat</span>
      <span><i class="strong"></i>Strong</span>
      <span><i class="drop"></i>Drop</span>
      <span><i class="fill"></i>Fill</span>
      <span><i class="effect"></i>Effect</span>
    </div>
  `;
};

const updateMusicPreview = () => {
  const src = getMusicSource();
  if (!src) {
    clearVideo(els.musicPreview);
    clearVideo(els.analyzedMusicPreview);
    els.musicPreview.dataset.sourcePath = "";
    els.analyzedMusicPreview.dataset.sourcePath = "";
    state.musicFileDuration = null;
    els.musicStatus.textContent = "No music selected";
    els.musicDirector.textContent = "Analyze music to build a cut and effects plan.";
    renderBeatTimeline(null);
    return;
  }

  if (isYoutubeMusicSource(src)) {
    clearVideo(els.musicPreview);
    clearVideo(els.analyzedMusicPreview);
    els.musicPreview.dataset.sourcePath = "";
    els.analyzedMusicPreview.dataset.sourcePath = "";
    els.musicStatus.textContent =
      "YouTube links are not direct music files. Choose a local music file instead.";
    els.musicDirector.textContent = "Music Director needs a local music file.";
    renderBeatTimeline(null);
    return;
  }

  setAudioPreviewSource(els.musicPreview, src);
  setAudioPreviewSource(els.analyzedMusicPreview, src);
  els.musicStatus.textContent = musicSummary(musicFromControls());
  els.musicDirector.textContent = musicDirectorSummary(state.project?.music);
  renderBeatTimeline(state.project?.music);
};

const renderMusicControls = (music) => {
  const src = music?.src || "";
  if (isRemoteMusicSource(src)) {
    els.musicUrl.value = src;
    els.musicPath.value = "";
  } else {
    els.musicPath.value = src;
    els.musicUrl.value = "";
  }
  els.musicStart.value = music ? music.start : 0;
  els.musicDuration.value = music ? music.duration : Math.max(3, totalHighlightSeconds() || 15);
  els.musicVolume.value = music ? music.volume : 0.35;
  els.sourceVolume.value = music ? music.sourceVolume : 0.75;
  els.musicEnabled.checked = music ? music.enabled !== false : false;
  els.muteSourceAudio.checked = Boolean(music?.muteSourceAudio);
  els.useEntireMusic.checked = Boolean(music?.useEntireFile);
  state.musicFileDuration = music?.detected?.audioDuration ?? state.musicFileDuration;
  applyEntireMusicFile();
  els.beatSyncEnabled.checked = Boolean(music?.beatSync?.enabled);
  els.beatSyncIntensity.value = music?.beatSync?.intensity || "tight";
  els.beatEditEnergy.value = music?.beatSync?.editEnergy || "balanced";
  updateMusicPreview();
  if (music?.detected) {
    setMusicProgress(100, "Music analyzed");
  } else {
    setMusicProgress(0, "Music ready");
  }
  els.musicDirector.textContent = musicDirectorSummary(music);
  renderBeatTimeline(music);
};

const refreshMusicReadiness = () => {
  const musicSource = getMusicSource();
  if (!musicSource) {
    setMusicNotice("Music ready", "No music selected", 0);
    return;
  }

  if (isYoutubeMusicSource(musicSource)) {
    setMusicNotice(
      "Local music file needed",
      "YouTube links are not direct music files. Choose a local music file instead.",
      0,
    );
    return;
  }

  try {
    validateMusicSource(musicSource);
  } catch (error) {
    setMusicNotice(
      "Choose audio",
      error instanceof Error ? error.message : "Choose a valid music file.",
      0,
    );
    return;
  }

  if (!state.project || !state.project.highlights?.length || totalHighlightSeconds() <= 0) {
    setMusicNotice(
      "Analyze hooks first",
      "Music selected. Analyze hooks first so the app knows the final hook duration.",
      0,
    );
    return;
  }

  if (state.project.music?.beats?.length) {
    const style = state.project.music.detected?.suggestedBeatStyle ||
      state.project.music.beatSync?.intensity ||
      "tight";
    const energy = state.project.music.detected?.suggestedEditEnergy ||
      state.project.music.beatSync?.editEnergy ||
      "balanced";
    setMusicNotice(
      "Music analyzed",
      `Music selected with ${state.project.music.beats.length} detected beats. Beat style auto-selected: ${style}. Edit energy recommended: ${energy}.`,
      100,
    );
    els.musicDirector.textContent = musicDirectorSummary(state.project.music);
    renderBeatTimeline(state.project.music);
    return;
  }

  setMusicNotice(
    "Music ready",
    "Music selected. Click Analyze Music to find the strongest part.",
    0,
  );
  els.musicDirector.textContent = "Analyze music to build a cut and effects plan.";
  renderBeatTimeline(null);
};

const syncRenderModeControls = () => {
  if (els.renderMode.value === "cpu") {
    els.glMode.value = "swiftshader";
  } else if (els.glMode.value === "swiftshader") {
    els.glMode.value = "angle";
  }

  els.glMode.disabled = Boolean(state.activeJob && isActiveJob()) ||
    els.renderMode.value === "cpu";
};

const syncOutputFormatControls = () => {
  const sourceOutput = els.outputAspectRatio.value === "source";
  els.autoReframe.disabled = sourceOutput || isActiveJob();
  if (sourceOutput) {
    els.autoReframe.checked = false;
  } else if (!state.project || state.project.outputAspectRatio === "source") {
    els.autoReframe.checked = true;
  } else if (state.project.reframeMode !== "none") {
    els.autoReframe.checked = true;
  }
};

const stopJobUpdates = () => {
  clearInterval(state.pollTimer);
  state.pollTimer = null;

  if (state.jobEvents) {
    state.jobEvents.close();
    state.jobEvents = null;
  }
};

const clearVideo = (video) => {
  video.pause();
  video.removeAttribute("src");
  video.load();
};

const clearPreviewTimer = () => {
  if (state.previewStopTimer) {
    clearTimeout(state.previewStopTimer);
    state.previewStopTimer = null;
  }
};

const setVideoSource = (video, src) => {
  if (video.getAttribute("src") === src) {
    return;
  }

  video.src = src;
};

const setAudioPreviewSource = (audio, src) => {
  if (audio.dataset.sourcePath === src) {
    return;
  }

  audio.dataset.sourcePath = src;
  setVideoSource(
    audio,
    isRemoteMusicSource(src)
      ? src
      : `/api/video?path=${encodeURIComponent(src)}&t=${Date.now()}`,
  );
};

const analyzedMusicRange = () => {
  const music = musicFromControls();
  if (!music?.src) {
    return null;
  }

  const start = Math.max(0, Number(music.start) || 0);
  const duration = Math.max(0.1, Number(music.duration) || 0.1);

  return {
    start,
    end: start + duration,
  };
};

const seekAnalyzedMusicStart = () => {
  const range = analyzedMusicRange();
  if (!range || !els.analyzedMusicPreview.getAttribute("src")) {
    return;
  }

  try {
    els.analyzedMusicPreview.currentTime = range.start;
  } catch {
    // Metadata may not be loaded yet. The play handler will seek again.
  }
};

const stopAnalyzedMusicAtEnd = () => {
  const range = analyzedMusicRange();
  if (!range) {
    return;
  }

  if (els.analyzedMusicPreview.currentTime >= range.end) {
    els.analyzedMusicPreview.pause();
    seekAnalyzedMusicStart();
  }
};

const openFullscreen = async (video) => {
  if (!video.currentSrc && !video.getAttribute("src")) {
    els.processNote.textContent = "No preview is loaded";
    return;
  }

  const fullscreenTarget = video.requestFullscreen ? video : video.parentElement;
  await fullscreenTarget.requestFullscreen();
};

const resetProjectForNewSource = (src) => {
  state.project = null;
  state.thumbnails = [];
  state.hookVideoSource = "output";
  els.sourcePath.value = src;
  els.titleText.value = "";
  els.rangeStart.value = 0;
  els.rangeEnd.value = "";
  updateAnalyzeRangeNote();
  els.uploadStatus.textContent = src ? "Using original file path" : "";
  renderMetrics();
  renderHighlights();
  renderMusicControls(undefined);
  clearVideo(els.outputVideo);
  els.outputMeta.textContent = "-";

  if (src) {
    setVideoSource(
      els.sourceVideo,
      `/api/video?path=${encodeURIComponent(src)}&t=${Date.now()}`,
    );
    els.sourceMeta.textContent = "Selected";
  } else {
    clearVideo(els.sourceVideo);
    els.sourceMeta.textContent = "-";
  }

  setBusy(false);
};

const clearWorkspace = async ({skipConfirm = false} = {}) => {
  const confirmed =
    skipConfirm ||
    window.confirm(
      "Clear the current source, highlights, project data, and app-created workspace files? The rendered hook file stays saved.",
    );

  if (!confirmed) {
    return null;
  }

  setStatus("Clearing", "running");
  setProgress(0, "Clearing workspace");
  setBusy(true);

  try {
    const result = await api("/api/clear-workspace", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const data = await api("/api/state");
    state.project = data.project;
    state.thumbnails = data.thumbnails || [];
    state.activeJob = data.activeJob;
    state.hookVideoSource = "output";
    renderProject(data);
    setStatus("Cleared", "done");
    setProgress(100, "Workspace cleared");
    els.processNote.textContent = `Cleared source and highlights. Removed ${
      result.removed
    } managed file${result.removed === 1 ? "" : "s"} (${formatBytes(
      result.bytes,
    )}). Hook output kept.`;
    return result;
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
    throw error;
  } finally {
    setBusy(isActiveJob());
  }
};

const renderMetrics = () => {
  const project = state.project;
  const values = project
    ? [
        `${project.width}x${project.height}`,
        Number(project.fps).toFixed(3),
        String(project.highlights.length),
        seconds(beatSyncedDurationSeconds(project)),
      ]
    : ["-", "-", "-", "-"];

  [...els.metrics.querySelectorAll("strong")].forEach((node, index) => {
    node.textContent = values[index];
  });
};

const updateVideoSources = (serverState = {}) => {
  if (state.project?.src) {
    setVideoSource(els.sourceVideo, `/api/video?path=${encodeURIComponent(
      state.project.src,
    )}&t=${Date.now()}`);
    const source = getSourceDimensions(state.project);
    els.sourceMeta.textContent = `${source.width}x${source.height}`;
    els.sourceVideo.style.aspectRatio = `${source.width} / ${source.height}`;
  } else {
    clearVideo(els.sourceVideo);
    els.sourceMeta.textContent = "-";
    els.sourceVideo.style.aspectRatio = "";
  }

  const finalOutputPath = els.outputPath.value.trim() || serverState.outputPath;
  const previewPath = serverState.previewPath || state.activeJob?.result?.previewPath;
  const showPreview =
    state.hookVideoSource === "preview" &&
    Boolean(previewPath) &&
    Boolean(serverState.previewExists || state.activeJob?.result?.previewExists);
  const shouldShowOutput = Boolean(state.project) &&
    (showPreview ||
      serverState.outputExists ||
      state.activeJob?.result?.outputExists);
  const outputPath = showPreview ? previewPath : finalOutputPath;
  const displayWidth = showPreview
    ? Number(serverState.previewWidth || state.activeJob?.result?.previewWidth || state.project?.width)
    : Number(state.project?.width);
  const displayHeight = showPreview
    ? Number(serverState.previewHeight || state.activeJob?.result?.previewHeight || state.project?.height)
    : Number(state.project?.height);

  if (shouldShowOutput && outputPath) {
    setVideoSource(els.outputVideo, `/api/video?path=${encodeURIComponent(
      outputPath,
    )}&t=${Date.now()}`);
    els.outputMeta.textContent = showPreview
      ? `Fast preview ${displayWidth}x${displayHeight}`
      : `${displayWidth}x${displayHeight}`;
    els.outputVideo.style.aspectRatio = `${displayWidth} / ${displayHeight}`;
  } else {
    clearVideo(els.outputVideo);
    els.outputMeta.textContent = "-";
    els.outputVideo.style.aspectRatio = state.project
      ? `${state.project.width} / ${state.project.height}`
      : "";
  }
};

const renderHighlights = () => {
  const highlights = state.project?.highlights || [];
  els.highlightRows.innerHTML = "";

  if (!highlights.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="empty-row" colspan="4">No highlights</td>`;
    els.highlightRows.append(row);
    return;
  }

  highlights.forEach((highlight, index) => {
    const thumbnail = (state.thumbnails || []).find(
      (item) =>
        item.index === index &&
        Number(item.start) === Number(highlight.start) &&
        Number(item.duration) === Number(highlight.duration) &&
        item.url,
    );
    const metaSummary = highlightMetaSummary(highlight);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="thumb-stack">
          ${
            thumbnail
              ? `<button class="thumb-button" data-preview="${index}" type="button" title="Preview this hook"><img src="${thumbnail.url}" alt=""></button>`
              : `<button class="thumb-placeholder" data-preview="${index}" type="button" title="Preview this hook">Preview</button>`
          }
          ${metaSummary ? `<div class="thumb-meta">${escapeHtml(metaSummary)}</div>` : ""}
        </div>
      </td>
      <td><input data-index="${index}" data-field="start" type="number" min="0" step="0.01" value="${highlight.start}"></td>
      <td><input data-index="${index}" data-field="duration" type="number" min="0.01" step="0.01" value="${highlight.duration}"></td>
      <td><button class="remove-btn" data-remove="${index}">Remove</button></td>
    `;
    els.highlightRows.append(row);
  });
};

const generateThumbnails = async () => {
  if (!state.project) {
    return;
  }

  try {
    setStatus("Previews", "running");
    setProgress(92, "Generating hook previews");
    setBusy(true);
    const result = await api("/api/thumbnails", {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.thumbnails = result.thumbnails || [];
    renderHighlights();
    setStatus("Ready", "done");
    setProgress(100, "Review hooks, then render final");
  } finally {
    setBusy(isActiveJob());
  }
};

const previewHighlight = async (index) => {
  if (!state.project?.highlights[index]) {
    return;
  }

  const highlight = state.project.highlights[index];
  clearPreviewTimer();

  if (!els.sourceVideo.getAttribute("src")) {
    updateVideoSources();
  }

  els.sourceVideo.currentTime = Math.max(0, Number(highlight.start) || 0);
  els.processNote.textContent = `Previewing ${seconds(highlight.duration)} hook from ${seconds(highlight.start)}`;

  try {
    await els.sourceVideo.play();
    state.previewStopTimer = setTimeout(() => {
      els.sourceVideo.pause();
      state.previewStopTimer = null;
    }, Math.max(250, Number(highlight.duration || 0) * 1000));
  } catch {
    // Seeking still works if the browser blocks autoplay for any reason.
  }
};

const readRowsIntoProject = () => {
  if (!state.project) {
    return;
  }

  const next = state.project.highlights.map((highlight) => ({...highlight}));
  els.highlightRows.querySelectorAll("input[data-index]").forEach((input) => {
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    next[index][field] = Number(input.value);
  });

  state.project = {
    ...state.project,
    title: els.titleText.value.trim() || undefined,
    highlights: next.filter(
      (highlight) =>
        Number.isFinite(highlight.start) &&
        highlight.start >= 0 &&
        Number.isFinite(highlight.duration) &&
        highlight.duration > 0,
    ),
  };
  applyOutputFormatToProject();
  applyMusicToProject();
};

const renderProject = (serverState = {}) => {
  const project = state.project;

  if (project) {
    els.sourcePath.value = project.src;
    els.titleText.value = project.title || "";
    els.outputAspectRatio.value = project.outputAspectRatio || "source";
    els.effectPreset.value = displayEffectPreset(project.effectPreset);
    els.colorEnhancement.value = project.colorEnhancement || "off";
    els.autoReframe.checked =
      (project.outputAspectRatio || "source") !== "source" &&
      project.reframeMode !== "none";
    syncOutputFormatControls();
    renderMusicControls(project.music);
    if (project.highlights.length > 0) {
      els.clipDuration.value = project.highlights[0].duration;
    }
    els.rangeStart.value = formatTimecode(project.analysisRange?.start ?? 0);
    els.rangeEnd.value = Number.isFinite(project.analysisRange?.end)
      ? formatTimecode(project.analysisRange.end)
      : "";
    updateAnalyzeRangeNote();
    renderEffectRecommendation(project);
  } else {
    els.sourcePath.value = "";
    els.titleText.value = "";
    els.rangeStart.value = 0;
    els.rangeEnd.value = "";
    updateAnalyzeRangeNote();
    els.uploadStatus.textContent = "";
    els.outputAspectRatio.value = "source";
    els.effectPreset.value = "clean";
    renderEffectRecommendation(null);
    els.colorEnhancement.value = "off";
    els.autoReframe.checked = false;
    syncOutputFormatControls();
    renderMusicControls(undefined);
  }

  renderMetrics();
  renderHighlights();
  updateVideoSources(serverState);
  setBusy(isActiveJob());
};

const loadState = async () => {
  const data = await api("/api/state");
  state.project = data.project;
  state.thumbnails = data.thumbnails || [];
  state.activeJob = data.activeJob;
  els.outputPath.value = data.outputPath || els.outputPath.value;
  renderProject(data);

  if (data.activeJob) {
    followJob(data.activeJob.id);
  } else {
    setStatus("Idle");
    setProgress(data.outputExists ? 100 : 0, data.outputExists ? "Ready" : "Ready");
  }
};

const startRender = async () => {
  readRowsIntoProject();
  await api("/api/project", {
    method: "POST",
    body: JSON.stringify(state.project),
  });
  els.processNote.textContent = "Starting render...";
  const job = await api("/api/render", {
    method: "POST",
    body: JSON.stringify({
      out: els.outputPath.value,
      renderMode: els.renderMode.value,
      gl: els.glMode.value,
      concurrency: Number(els.concurrency.value),
      renderTimeoutMinutes: Number(els.renderTimeout.value),
    }),
  });
  state.activeJob = job;
  state.hookVideoSource = "output";
  setStatus("Render", "running");
  setProgress(job.progress, job.phase);
  followJob(job.id);
};

const startPreview = async () => {
  readRowsIntoProject();
  await api("/api/project", {
    method: "POST",
    body: JSON.stringify(state.project),
  });
  els.processNote.textContent =
    "Generating fast preview with current effects and music...";
  const job = await api("/api/preview", {
    method: "POST",
    body: JSON.stringify({
      renderMode: els.renderMode.value,
      gl: els.glMode.value,
      concurrency: Number(els.concurrency.value),
      renderTimeoutMinutes: Number(els.renderTimeout.value),
    }),
  });
  state.activeJob = job;
  state.hookVideoSource = "preview";
  setStatus("Preview", "running");
  setProgress(job.progress, job.phase);
  followJob(job.id);
};

const applyJobUpdate = async (job, options = {}) => {
  state.activeJob = job;
  setStatus(job.kind, job.status);
  if (job.kind === "music") {
    setMusicProgress(job.progress, job.phase);
  } else {
    setProgress(job.progress, job.phase);
  }
  setBusy(isActiveJob(job));

  if (isActiveJob(job)) {
    return;
  }

  stopJobUpdates();
  setBusy(false);
  setStatus(
    job.status === "done"
      ? "Done"
      : job.status === "cancelled"
        ? "Cancelled"
        : "Failed",
    job.status,
  );
  if (job.kind === "music") {
    setMusicProgress(job.progress, job.phase);
  } else {
    setProgress(job.progress, job.phase);
  }

  if (job.status === "failed") {
    const lines = (job.logs || "").split(/\r?\n/).filter(Boolean);
    const message = lines.at(-1) || "Process failed";
    if (job.kind === "music") {
      els.musicStatus.textContent = message;
    } else {
      els.processNote.textContent = message;
    }
  }

  if (job.status === "cancelled") {
    if (job.kind === "music") {
      els.musicStatus.textContent = "Music analysis cancelled";
    } else {
      els.processNote.textContent = `${job.kind} cancelled`;
    }
  }

  if (job.status !== "done") {
    return;
  }

  const data = await api("/api/state");
  state.project = data.project;
  state.thumbnails = data.thumbnails || [];
  if (job.kind === "analyze" && state.project) {
    els.outputAspectRatio.value = state.pendingOutputAspectRatio || "source";
    els.autoReframe.checked = Boolean(state.pendingAutoReframe);
    applyRecommendedEffectToControls(state.project);
    applyOutputFormatToProject();
    await api("/api/project", {
      method: "POST",
      body: JSON.stringify(state.project),
    });
  }
  renderProject(data);

  if (job.kind === "music") {
    applyRecommendedEffectToControls(state.project);
    if (state.project) {
      applyOutputFormatToProject();
      await api("/api/project", {
        method: "POST",
        body: JSON.stringify(state.project),
      });
    }
    renderProject({project: state.project, thumbnails: state.thumbnails});
    setMusicProgress(100, "Music analysis complete");
    const style = state.project?.music?.detected?.suggestedBeatStyle ||
      state.project?.music?.beatSync?.intensity ||
      "tight";
    const energy = state.project?.music?.detected?.suggestedEditEnergy ||
      state.project?.music?.beatSync?.editEnergy ||
      "balanced";
    const recommendation = getEffectRecommendation(state.project);
    const effectText = recommendation
      ? ` Effect auto-selected: ${
          effectLabels[displayEffectPreset(recommendation.preset)] ||
          effectLabels[recommendation.preset] ||
          recommendation.preset
        }.`
      : "";
    const plan = state.project?.music?.editPlan;
    const directorText = plan
      ? ` Music Director created ${plan.cutPoints?.length || 0} cut points and ${plan.effectEvents?.length || 0} effect hits.`
      : "";
    els.musicStatus.textContent = state.project?.music?.beats?.length
      ? `Strongest music section selected with ${state.project.music.beats.length} detected beats. Beat style auto-selected: ${style}. Edit energy recommended: ${energy}.${effectText}${directorText}`
      : `Strongest music section selected for the final hook. Edit energy recommended: ${energy}.${effectText}${directorText}`;
    els.musicDirector.textContent = musicDirectorSummary(state.project?.music);
    return;
  }

  if (job.kind === "preview") {
    state.hookVideoSource = "preview";
    els.processNote.textContent = "Fast preview ready in the Hook player";
    updateVideoSources({
      ...data,
      previewExists: job.result?.previewExists ?? data.previewExists,
      previewPath: job.result?.previewPath ?? data.previewPath,
    });
    return;
  }

  if (job.kind === "render") {
    state.hookVideoSource = "output";
    updateVideoSources({
      ...data,
      outputExists: job.result?.outputExists ?? data.outputExists,
      outputPath: job.result?.outputPath ?? data.outputPath,
    });
  }

  if (job.kind === "analyze" && options.generatePreviewsAfterAnalyze) {
    els.processNote.textContent = "Analysis complete. Generating previews...";
    generateThumbnails().catch((error) => {
      setStatus("Failed", "failed");
      els.processNote.textContent = error.message;
    }).finally(() => {
      setBusy(isActiveJob());
    });
    return;
  }

  if (job.kind === "render" && els.clearAfterRender.checked) {
    const result = await clearWorkspace({skipConfirm: true});
    if (!result) {
      return;
    }
    setStatus("Done", "done");
    setProgress(100, "Render complete");
    els.processNote.textContent = `Render complete. Cleared source and highlights. Removed ${
      result.removed
    } managed file${result.removed === 1 ? "" : "s"} (${formatBytes(
      result.bytes,
    )}).`;
  }
};

const followJobWithPolling = (id, options = {}) => {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const job = await api(`/api/jobs/${id}`);
    await applyJobUpdate(job, options);
  }, 700);
};

const followJob = (id, options = {}) => {
  stopJobUpdates();
  setBusy(true);

  if (!("EventSource" in window)) {
    followJobWithPolling(id, options);
    return;
  }

  const source = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
  state.jobEvents = source;

  source.addEventListener("job", (event) => {
    const job = JSON.parse(event.data);
    applyJobUpdate(job, options).catch((error) => {
      setStatus("Failed", "failed");
      els.processNote.textContent = error.message;
    });
  });

  source.onerror = () => {
    if (state.jobEvents !== source) {
      return;
    }

    source.close();
    state.jobEvents = null;

    if (isActiveJob()) {
      if (state.activeJob?.kind === "music") {
        els.musicStatus.textContent = "Live music progress disconnected. Falling back to polling.";
      } else {
        els.processNote.textContent = "Live progress disconnected. Falling back to polling.";
      }
      followJobWithPolling(id, options);
    }
  };
};

els.analyzeBtn.addEventListener("click", async () => {
  try {
    state.pendingOutputAspectRatio = els.outputAspectRatio.value;
    state.pendingAutoReframe = els.autoReframe.checked;
    validateSourceVideoPath(els.sourcePath.value);
    const analyzeRange = readAnalyzeRange();
    els.processNote.textContent = "Starting analysis...";
    const job = await api("/api/analyze", {
      method: "POST",
      body: JSON.stringify({
        input: els.sourcePath.value,
        clipDuration: Number(els.clipDuration.value),
        maxClips: Number(els.maxClips.value),
        sceneThreshold: Number(els.sceneThreshold.value),
        rangeStart: analyzeRange.rangeStart,
        rangeEnd: analyzeRange.rangeEnd,
      }),
    });
    state.activeJob = job;
    setStatus("Analyze", "running");
    setProgress(job.progress, job.phase);
    followJob(job.id, {generatePreviewsAfterAnalyze: true});
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  }
});

els.cancelJobBtn.addEventListener("click", async () => {
  if (!isActiveJob()) {
    return;
  }

  try {
    els.cancelJobBtn.disabled = true;
    setStatus("Cancelling", "cancelling");
    if (state.activeJob.kind === "music") {
      setMusicProgress(state.activeJob.progress, "Cancelling music analysis");
    } else {
      setProgress(state.activeJob.progress, `Cancelling ${state.activeJob.kind}`);
    }
    const result = await api("/api/cancel-job", {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (!result.activeJob) {
      state.activeJob = null;
      setBusy(false);
      setStatus("Idle");
      setProgress(0, "Ready");
      return;
    }

    state.activeJob = result.activeJob;
    setBusy(isActiveJob());
    followJob(result.activeJob.id);
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
    setBusy(isActiveJob());
  }
});

els.chooseFileBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    setStatus("Choosing", "running");
    els.processNote.textContent = "Choose the source video file";
    const result = await api("/api/choose-source", {
      method: "POST",
      body: JSON.stringify({current: els.sourcePath.value}),
    });

    if (result.cancelled) {
      setStatus("Idle");
      els.processNote.textContent = "Source path unchanged";
      return;
    }

    resetProjectForNewSource(result.src);
    setStatus("Ready", "done");
    setProgress(100, "Source selected");
    els.processNote.textContent = "Source selected without copying";
  } catch (error) {
    setStatus("Failed", "failed");
    els.uploadStatus.textContent = "";
    els.processNote.textContent = error.message;
  } finally {
    setBusy(isActiveJob());
  }
});

els.chooseOutputBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    setStatus("Choosing", "running");
    els.processNote.textContent = "Choose where to save hook.mp4";
    const result = await api("/api/choose-output", {
      method: "POST",
      body: JSON.stringify({current: els.outputPath.value}),
    });

    if (result.cancelled) {
      setStatus("Idle");
      els.processNote.textContent = "Output path unchanged";
      return;
    }

    els.outputPath.value = result.outputPath;
    setStatus("Ready", "done");
    els.processNote.textContent = "Output path selected";
    updateVideoSources({
      outputPath: result.outputPath,
      outputExists: result.outputExists,
    });
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  } finally {
    setBusy(isActiveJob());
  }
});

els.chooseMusicBtn.addEventListener("click", async () => {
  try {
    setBusy(true);
    setStatus("Choosing", "running");
    els.processNote.textContent = "Choose the music file";
    const result = await api("/api/choose-music", {
      method: "POST",
      body: JSON.stringify({current: els.musicPath.value}),
    });

    if (result.cancelled) {
      setStatus("Idle");
      els.processNote.textContent = "Music path unchanged";
      return;
    }

    els.musicPath.value = result.src;
    els.musicUrl.value = "";
    state.musicFileDuration = Number.isFinite(Number(result.duration))
      ? Number(result.duration)
      : null;
    if (els.useEntireMusic.checked && state.musicFileDuration) {
      els.musicStart.value = "0";
      els.musicDuration.value = Number(state.musicFileDuration.toFixed(3));
    } else {
      els.musicDuration.value = Math.max(3, totalHighlightSeconds() || 15);
    }
    els.musicEnabled.checked = true;
    applyMusicToProject();
    updateMusicPreview();
    refreshMusicReadiness();
    setStatus("Ready", "done");
    els.processNote.textContent = state.project
      ? "Music selected. Analyze it to find the strongest part."
      : "Music selected. Analyze hooks first, then analyze music.";
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  } finally {
    setBusy(isActiveJob());
  }
});

els.analyzeMusicBtn.addEventListener("click", async () => {
  try {
    const musicSource = getMusicSource();
    setMusicNotice("Checking music setup", "Checking music file and hook timeline...", 3);
    validateMusicSource(musicSource);

    if (!state.project || !state.project.highlights?.length || totalHighlightSeconds() <= 0) {
      throw new Error("Analyze hooks first, then analyze music. Music analysis needs the final hook duration.");
    }

    setMusicNotice("Saving music settings", "Saving music settings before analysis...", 8);
    applyMusicToProject();
    await api("/api/project", {
      method: "POST",
      body: JSON.stringify(state.project),
    });
    setMusicNotice("Starting music analysis", "Sending music analysis job to the backend...", 12);
    const job = await api("/api/analyze-music", {
      method: "POST",
      body: JSON.stringify({
        input: musicSource,
        useEntireFile: els.useEntireMusic.checked,
      }),
    });
    state.activeJob = job;
    setStatus("Music", "running");
    setMusicProgress(job.progress, job.phase);
    followJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Music analysis failed.";
    const phase = message.includes("Analyze hooks")
      ? "Analyze hooks first"
      : message.includes("YouTube")
        ? "Local music file needed"
        : "Music analysis stopped";
    setStatus("Failed", "failed");
    setMusicNotice(phase, message, 0);
    setBusy(isActiveJob());
  }
});

els.removeMusicBtn.addEventListener("click", async () => {
  if (state.project) {
    state.project = {...state.project, music: undefined};
    await api("/api/project", {
      method: "POST",
      body: JSON.stringify(state.project),
    }).catch((error) => {
      els.processNote.textContent = error.message;
    });
  }

  renderMusicControls(undefined);
  setMusicProgress(0, "Music ready");
  state.musicFileDuration = null;
  els.useEntireMusic.checked = false;
  els.beatSyncEnabled.checked = false;
  els.beatSyncIntensity.value = "tight";
  els.beatEditEnergy.value = "balanced";
  els.musicDirector.textContent = "Analyze music to build a cut and effects plan.";
  renderBeatTimeline(null);
  setBusy(isActiveJob());
});

els.sourceFullscreenBtn.addEventListener("click", () => {
  openFullscreen(els.sourceVideo).catch((error) => {
    els.processNote.textContent = error.message;
  });
});

els.outputFullscreenBtn.addEventListener("click", () => {
  openFullscreen(els.outputVideo).catch((error) => {
    els.processNote.textContent = error.message;
  });
});

els.clearWorkspaceBtn.addEventListener("click", () => {
  clearWorkspace().catch(() => {});
});

els.clearAfterRender.addEventListener("change", () => {
  if (!els.clearAfterRender.checked) {
    return;
  }

  const confirmed = window.confirm(
    "After each render, clear the current source, highlights, project data, and app-created workspace files? The rendered hook file stays saved.",
  );
  if (!confirmed) {
    els.clearAfterRender.checked = false;
  }
});

els.renderMode.addEventListener("change", () => {
  syncRenderModeControls();
});

els.outputAspectRatio.addEventListener("change", () => {
  syncOutputFormatControls();
  applyOutputFormatToProject();
  renderMetrics();
  updateVideoSources();
});

els.effectPreset.addEventListener("change", () => {
  applyOutputFormatToProject();
});

els.colorEnhancement.addEventListener("change", () => {
  applyOutputFormatToProject();
});

els.autoReframe.addEventListener("change", () => {
  applyOutputFormatToProject();
});

els.musicPreview.addEventListener("play", () => {
  els.analyzedMusicPreview.pause();
});

els.musicPreview.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(els.musicPreview.duration) && els.musicPreview.duration > 0) {
    state.musicFileDuration = els.musicPreview.duration;
    if (applyEntireMusicFile()) {
      applyMusicToProject();
      updateMusicPreview();
      renderMetrics();
      setBusy(isActiveJob());
    }
  }
});

els.analyzedMusicPreview.addEventListener("play", () => {
  els.musicPreview.pause();
  const range = analyzedMusicRange();
  if (!range) {
    return;
  }

  if (
    els.analyzedMusicPreview.currentTime < range.start ||
    els.analyzedMusicPreview.currentTime >= range.end
  ) {
    seekAnalyzedMusicStart();
  }
});

els.analyzedMusicPreview.addEventListener("loadedmetadata", () => {
  if (
    Number.isFinite(els.analyzedMusicPreview.duration) &&
    els.analyzedMusicPreview.duration > 0
  ) {
    state.musicFileDuration = els.analyzedMusicPreview.duration;
    if (applyEntireMusicFile()) {
      applyMusicToProject();
      renderMetrics();
      setBusy(isActiveJob());
    }
  }
  seekAnalyzedMusicStart();
});

els.analyzedMusicPreview.addEventListener("timeupdate", () => {
  stopAnalyzedMusicAtEnd();
});

[
  els.musicPath,
  els.musicUrl,
  els.musicStart,
  els.musicDuration,
  els.musicVolume,
  els.sourceVolume,
  els.musicEnabled,
  els.muteSourceAudio,
  els.useEntireMusic,
  els.beatSyncEnabled,
  els.beatSyncIntensity,
  els.beatEditEnergy,
].forEach((input) => {
  input.addEventListener("input", () => {
    if (input === els.useEntireMusic) {
      applyEntireMusicFile();
    }
    applyMusicToProject();
    updateMusicPreview();
    if (input === els.musicPath || input === els.musicUrl) {
      refreshMusicReadiness();
    }
    if (
      input === els.musicStart ||
      input === els.musicDuration ||
      input === els.useEntireMusic ||
      input === els.beatSyncEnabled ||
      input === els.beatSyncIntensity ||
      input === els.beatEditEnergy
    ) {
      seekAnalyzedMusicStart();
      renderMetrics();
      renderBeatTimeline(state.project?.music);
    }
    setBusy(isActiveJob());
  });
  input.addEventListener("change", () => {
    if (input === els.useEntireMusic) {
      applyEntireMusicFile();
    }
    applyMusicToProject();
    updateMusicPreview();
    if (input === els.musicPath || input === els.musicUrl) {
      refreshMusicReadiness();
    }
    if (
      input === els.musicStart ||
      input === els.musicDuration ||
      input === els.useEntireMusic ||
      input === els.beatSyncEnabled ||
      input === els.beatSyncIntensity ||
      input === els.beatEditEnergy
    ) {
      seekAnalyzedMusicStart();
      renderMetrics();
      renderBeatTimeline(state.project?.music);
    }
    setBusy(isActiveJob());
  });
});

els.saveProjectBtn.addEventListener("click", async () => {
  try {
    readRowsIntoProject();
    const data = await api("/api/project", {
      method: "POST",
      body: JSON.stringify(state.project),
    });
    state.project = data.project;
    state.thumbnails = data.thumbnails || [];
    renderProject();
    await generateThumbnails();
    setStatus("Saved", "done");
    setProgress(100, "Project saved");
  } catch (error) {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  }
});

els.renderFinalBtn.addEventListener("click", () => {
  startRender().catch((error) => {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  });
});

els.previewHookBtn.addEventListener("click", () => {
  startPreview().catch((error) => {
    setStatus("Failed", "failed");
    els.processNote.textContent = error.message;
  });
});

els.reloadBtn.addEventListener("click", () => {
  loadState().catch((error) => {
    els.processNote.textContent = error.message;
  });
});

els.rangeStart.addEventListener("input", updateAnalyzeRangeNote);
els.rangeEnd.addEventListener("input", updateAnalyzeRangeNote);
els.rangeStartNowBtn.addEventListener("click", () => {
  setRangeTimeFromPlayer(els.rangeStart);
});
els.rangeEndNowBtn.addEventListener("click", () => {
  setRangeTimeFromPlayer(els.rangeEnd);
});
els.fullRangeBtn.addEventListener("click", () => {
  els.rangeStart.value = 0;
  els.rangeEnd.value = "";
  updateAnalyzeRangeNote();
});

els.addHighlightBtn.addEventListener("click", () => {
  if (!state.project) {
    const outputAspectRatio = els.outputAspectRatio.value || "source";
    const dimensions = dimensionsForAspect(outputAspectRatio, {
      width: 1920,
      height: 1080,
      sourceWidth: 1920,
      sourceHeight: 1080,
    });
    state.project = {
      src: els.sourcePath.value.trim(),
      width: dimensions.width,
      height: dimensions.height,
      sourceWidth: 1920,
      sourceHeight: 1080,
      fps: 30,
      outputAspectRatio,
      reframeMode:
        outputAspectRatio === "source" || !els.autoReframe.checked
          ? "none"
          : "auto",
      colorEnhancement: els.colorEnhancement.value || "off",
      effectPreset: els.effectPreset.value || "clean",
      music: musicFromControls(),
      title: els.titleText.value.trim() || undefined,
      highlights: [],
    };
  } else {
    readRowsIntoProject();
  }

  const start =
    state.project.highlights.length === 0
      ? 0
      : state.project.highlights.reduce(
          (max, highlight) => Math.max(max, highlight.start + highlight.duration),
          0,
        );

  state.project.highlights.push({
    start: Number(start.toFixed(2)),
    duration: 3,
  });
  state.thumbnails = [];
  renderProject();
});

els.highlightRows.addEventListener("click", (event) => {
  const preview = event.target.closest("button[data-preview]");
  if (preview) {
    previewHighlight(Number(preview.dataset.preview)).catch((error) => {
      els.processNote.textContent = error.message;
    });
    return;
  }

  const button = event.target.closest("button[data-remove]");
  if (!button || !state.project) {
    return;
  }

  readRowsIntoProject();
  state.project.highlights.splice(Number(button.dataset.remove), 1);
  state.thumbnails = [];
  renderProject();
});

els.highlightRows.addEventListener("input", () => {
  readRowsIntoProject();
  state.thumbnails = [];
  renderMetrics();
});

loadState().catch((error) => {
  setStatus("Failed", "failed");
  els.processNote.textContent = error.message;
});
