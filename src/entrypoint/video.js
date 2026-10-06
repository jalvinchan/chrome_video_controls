// Classic content script, injected after a toolbar action or shortcut.
// Keep this file self-contained: content scripts cannot import ES modules.
(() => {
  if (globalThis.__amplifierVideoControls) return;
  globalThis.__amplifierVideoControls = true;

  const storageKey = "playbackRate";
  let desiredRate = 1;
  let preferenceVersion = 0;
  const tracked = new Set();
  const rates = new WeakMap();
  const normalize = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Playback speed must be a finite number.");
    }
    return Number((Math.round(Math.min(4, Math.max(0.25, value)) / 0.05) * 0.05).toFixed(2));
  };

  function apply(video, rate = rates.get(video) ?? desiredRate) {
    rates.set(video, rate);
    video.preservesPitch = true;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  }

  function scan() {
    for (const video of tracked) {
      if (!video.isConnected) {
        video.removeEventListener("loadedmetadata", onSource);
        video.removeEventListener("play", onSource);
        tracked.delete(video);
      }
    }
    for (const video of document.querySelectorAll("video")) {
      if (tracked.has(video)) continue;
      tracked.add(video);
      video.addEventListener("loadedmetadata", onSource);
      video.addEventListener("play", onSource);
      apply(video);
    }
  }

  function onSource(event) {
    // A new source uses the global preference. Resuming an existing video
    // keeps that tab's choice even if another tab has changed the preference.
    apply(event.currentTarget, event.type === "loadedmetadata" ? desiredRate : rates.get(event.currentTarget));
  }

  function primaryVideo() {
    // Prefer a visible, playing video, then the largest visible player.
    return [...tracked].sort((a, b) => score(b) - score(a))[0];
  }

  function score(video) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    return area > 0 ? area + (!video.paused && !video.ended ? 1e12 : 0) : 0;
  }

  function snapshot() {
    const video = primaryVideo();
    return { available: Boolean(video), rate: video?.playbackRate ?? desiredRate, savedRate: desiredRate };
  }

  const ready = chrome.storage.local.get(storageKey).then((stored) => {
    if (!preferenceVersion && typeof stored[storageKey] === "number" && Number.isFinite(stored[storageKey])) {
      desiredRate = normalize(stored[storageKey]);
    }
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
  let chain = ready;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[storageKey]) return;
    const value = changes[storageKey].newValue;
    desiredRate = typeof value === "number" && Number.isFinite(value) ? normalize(value) : 1;
    preferenceVersion += 1;
    // Other tabs keep their current speed. New videos use the latest preference.
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "video") return;
    const operation = chain.then(async () => {
      scan();
      if (message.type === "snapshot") return snapshot();
      if (message.type !== "setRate" && message.type !== "adjustRate") {
        throw new Error("Unknown video control.");
      }
      if (message.type === "adjustRate" && (typeof message.delta !== "number" || !Number.isFinite(message.delta))) {
        throw new Error("Playback speed adjustment must be a finite number.");
      }
      const rate = normalize(message.type === "adjustRate" ? snapshot().rate + message.delta : message.rate);
      const previousRate = desiredRate;
      const previousVideos = [...tracked].map((video) => ({
        video, rate: video.playbackRate, defaultRate: video.defaultPlaybackRate,
        preferredRate: rates.get(video), preservesPitch: video.preservesPitch,
      }));
      desiredRate = rate;
      try {
        for (const video of tracked) apply(video, rate);
        await chrome.storage.local.set({ [storageKey]: rate });
      } catch (error) {
        desiredRate = previousRate;
        for (const previous of previousVideos) {
          rates.set(previous.video, previous.preferredRate);
          previous.video.preservesPitch = previous.preservesPitch;
          previous.video.defaultPlaybackRate = previous.defaultRate;
          previous.video.playbackRate = previous.rate;
        }
        throw error;
      }
      return snapshot();
    });
    chain = operation.catch(() => {});
    operation.then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error.message }),
    );
    return true;
  });
  ready.catch((error) => console.error("Video controls:", error));
})();
