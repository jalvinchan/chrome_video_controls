// Classic content script, injected after a toolbar action or shortcut.
// Keep this file self-contained: content scripts cannot import ES modules.
(() => {
  if (globalThis.__amplifierVideoControls) return;
  globalThis.__amplifierVideoControls = true;

  let storageKey;
  const pendingPreferences = new Map();
  let desiredRate = 1;
  const tracked = new Set();
  const rates = new WeakMap();
  const bookmarkSources = new WeakMap();
  let shownBookmarkKey = null;
  let loop = null;
  let loopError = null;
  let acceleration = null;
  const mediaEvents = ["play", "playing", "pause", "timeupdate", "seeking", "seeked", "ended", "durationchange", "progress", "ratechange"];
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
    video.playbackRate = acceleration?.video === video ? Math.max(3, rate) : rate;
  }

  function stopAcceleration() {
    if (!acceleration) return;
    const video = acceleration.video;
    acceleration = null;
    apply(video);
    notify();
  }

  function isTyping(event) {
    return (event.composedPath?.() ?? [event.target]).some((element) =>
      element?.isContentEditable || element?.matches?.("input, textarea, select, [role='textbox']"));
  }

  function onHoldKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) {
      stopAcceleration();
      return;
    }
    if (event.code !== "KeyR" || event.repeat || event.defaultPrevented || isTyping(event)
      || document.hidden || acceleration) return;
    scan();
    const video = primaryVideo();
    if (!video || score(video) === 0 || video.readyState < 1 || video.ended) return;
    // Keep the actual page speed as the baseline; the temporary rate never
    // becomes the saved preference or leaks to another video.
    rates.set(video, video.playbackRate);
    acceleration = { video, source: sourceOf(video), url: document.URL };
    apply(video);
    event.preventDefault();
    notify();
  }

  function scan() {
    for (const video of tracked) {
      if (!video.isConnected) {
        if (loop?.video === video) clearLoop();
        video.removeEventListener("loadedmetadata", onSource);
        video.removeEventListener("play", onSource);
        video.removeEventListener("emptied", onResetSource);
        video.removeEventListener("loadstart", onResetSource);
        for (const event of mediaEvents) video.removeEventListener(event, onMedia);
        tracked.delete(video);
      }
    }
    for (const video of document.querySelectorAll("video")) {
      if (tracked.has(video)) continue;
      tracked.add(video);
      rememberBookmarkSource(video);
      video.addEventListener("loadedmetadata", onSource);
      video.addEventListener("play", onSource);
      video.addEventListener("emptied", onResetSource);
      video.addEventListener("loadstart", onResetSource);
      for (const event of mediaEvents) video.addEventListener(event, onMedia);
      apply(video);
    }
    validateIdentity();
    const key = selectedBookmarkKey();
    if (key !== shownBookmarkKey) {
      shownBookmarkKey = key;
      notify();
    }
  }

  function onSource(event) {
    // A new source uses the saved preference. Resuming an existing video
    // keeps that tab's choice even if another tab has changed the preference.
    if (event.type === "loadedmetadata") onResetSource(event);
    else validateIdentity();
    const video = event.currentTarget;
    apply(video, event.type === "loadedmetadata"
      ? desiredRate : rates.get(video));
    if (event.type === "loadedmetadata") {
      rememberBookmarkSource(event.currentTarget);
      notify();
    }
  }

  function notify() {
    // Endpoint/source changes are infrequent. Never store or broadcast frames.
    chrome.runtime.sendMessage({ type: "videoControlsChanged" }).catch(() => {});
  }

  function sourceOf(video) {
    return `${video.currentSrc || ""}\n${video.getAttribute?.("src") || ""}`;
  }

  function validateIdentity() {
    if (acceleration && (!acceleration.video.isConnected || acceleration.source !== sourceOf(acceleration.video)
      || acceleration.url !== document.URL)) stopAcceleration();
    if (loop && (!loop.video.isConnected || loop.source !== sourceOf(loop.video)
      || loop.url !== document.URL)) clearLoop();
  }

  function cancelChecks() {
    if (!loop) return;
    if (loop.frame != null) loop.video.cancelVideoFrameCallback?.(loop.frame);
    if (loop.animation != null) cancelAnimationFrame(loop.animation);
    if (loop.timer != null) clearTimeout(loop.timer);
    loop.frame = loop.animation = loop.timer = null;
  }

  function clearLoop(error = null) {
    const changed = Boolean(loop) || loopError !== error;
    cancelChecks();
    loop = null;
    loopError = error;
    if (changed) notify();
  }

  function onResetSource(event) {
    if (acceleration?.video === event.currentTarget) stopAcceleration();
    if (loop?.video === event.currentTarget) clearLoop();
    if (event.type !== "loadedmetadata") {
      bookmarkSources.delete(event.currentTarget);
      notify();
    }
  }

  function bookmarkIdentity(video) {
    const page = new URL(document.URL);
    const source = video.currentSrc;
    if (!source) return null;
    const media = new URL(source, document.URL);
    if (media.protocol === "blob:") {
      // A temporary media address changes on reload. A single-video page's
      // address is a durable fallback; retain query parameters that identify
      // its content, and hash routes used by client-side navigation.
      if (!["https:", "http:"].includes(page.protocol)
        || [...tracked].filter((item) => item.isConnected).length !== 1) return null;
      if (!page.hash.startsWith("#/") && !page.hash.startsWith("#!")) page.hash = "";
      page.searchParams.sort();
      const key = `page:${page.href}`;
      return key.length <= 4096 ? key : null;
    }
    if (media.protocol !== "https:" && media.protocol !== "http:") return null;
    media.hash = "";
    const key = `media:${media.href}`;
    return key.length <= 4096 ? key : null;
  }

  function bookmarkKey(video) {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0
      || video.readyState < 1) return null;
    return bookmarkIdentity(video);
  }

  function rememberBookmarkSource(video) {
    // Record the loaded source so stale commands cannot target a replacement.
    bookmarkSources.set(video, { key: bookmarkIdentity(video), source: sourceOf(video) });
  }

  function selectedBookmarkKey(video = primaryVideo()) {
    if (!video) return null;
    const key = bookmarkKey(video);
    const recorded = bookmarkSources.get(video);
    return recorded?.key === key && recorded?.source === sourceOf(video) ? key : null;
  }

  function bookmarkContext(expectedKey) {
    const video = primaryVideo();
    if (!video) throw new Error("No video found. Open a video to use bookmarks.");
    const key = bookmarkKey(video);
    if (!key) throw new Error("Bookmarks need a loaded on-demand video with a stable video address; live streams aren't supported.");
    const recorded = bookmarkSources.get(video);
    if (recorded?.key !== key || recorded.source !== sourceOf(video)) {
      throw new Error("Wait for the new video to load, then try the bookmark again.");
    }
    if (expectedKey !== key) throw new Error("The video changed. Choose a bookmark for the current video.");
    return { video, key };
  }

  function captureBookmark(key) {
    const context = bookmarkContext(key);
    const video = context.video;
    if (video.seeking) throw new Error("Wait for the current seek to finish, then save the bookmark.");
    if (!Number.isFinite(video.currentTime) || video.currentTime < 0 || video.currentTime > video.duration) {
      throw new Error("Choose a time within the video's duration.");
    }
    return { key: context.key, time: video.currentTime };
  }

  function seekBookmark(key, time) {
    const { video } = bookmarkContext(key);
    if (!Number.isFinite(time) || time < 0 || time > video.duration) throw new Error("This bookmark is outside the video's duration.");
    if (video.seeking) throw new Error("Wait for the current seek to finish, then choose the bookmark again.");
    const ranges = video.seekable;
    let seekable = false;
    for (let i = 0; i < (ranges?.length ?? 0); i += 1) {
      if (time >= ranges.start(i) && time <= ranges.end(i)) seekable = true;
    }
    if (!seekable) throw new Error("That bookmark isn't seekable yet. Wait for the video to load, then try again.");
    video.currentTime = time;
    if (loop?.video === video && loop.b != null && (time < loop.a || time >= loop.b)) clearLoop();
    return snapshot();
  }

  function seekRange(video, a, b = a) {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("A–B repeat needs a loaded on-demand video; live streams aren't supported.");
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b > video.duration) {
      throw new Error("Choose A and B within the video's duration.");
    }
    const ranges = video.seekable;
    for (let i = 0; i < (ranges?.length ?? 0); i += 1) {
      if (a >= ranges.start(i) && b <= ranges.end(i)) return;
    }
    throw new Error("That section isn't seekable yet. Wait for the video to load, then set the points again.");
  }

  function setPoint(point) {
    const video = primaryVideo();
    if (!video) throw new Error("No video found. Open a video, then set a loop point.");
    if (video.seeking) throw new Error("Wait for the current seek to finish, then set the point again.");
    const time = video.currentTime;
    if (point === "b") {
      if (loop?.video !== video || loop.a == null) throw new Error("Set A before setting B.");
      if (time <= loop.a) throw new Error("B must be after A. Move forward in the video, then set B.");
      seekRange(video, loop.a, time);
    } else seekRange(video, time);
    // Setting A starts a new selection. Failed selections keep the old loop.
    if (point === "a") {
      clearLoop();
      loop = { video, source: sourceOf(video), url: document.URL, a: time, b: null,
        seeking: false, wasPlaying: !video.paused && !video.ended };
    } else loop.b = time;
    loopError = null;
    notify();
    scheduleChecks();
    return snapshot();
  }

  function checkBoundary() {
    validateIdentity();
    const current = loop;
    if (!current || current.b == null) return;
    const video = current.video;
    try { seekRange(video, current.a, current.b); }
    catch (error) { clearLoop(error.message); return; }
    if (video.paused || video.ended || video.seeking || current.seeking) return;
    if (video.currentTime >= current.b) {
      current.seeking = true;
      try { video.currentTime = current.a; }
      catch { clearLoop("Couldn't seek to A. Clear the loop and try again."); }
    }
  }

  function scheduleChecks() {
    if (!loop || loop.b == null || loop.video.paused || loop.video.ended) return;
    const current = loop;
    const frame = () => {
      if (loop !== current) return;
      current.frame = current.animation = null;
      checkBoundary();
      scheduleChecks();
    };
    if (current.frame == null && current.animation == null) {
      if (typeof current.video.requestVideoFrameCallback === "function") {
        current.frame = current.video.requestVideoFrameCallback(frame);
      } else current.animation = requestAnimationFrame(frame);
    }
    // Frame callbacks may stop in hidden tabs. timeupdate and this watchdog
    // provide best-effort checks there, subject to browser timer throttling.
    if (current.timer == null) current.timer = setTimeout(() => {
      if (loop !== current) return;
      current.timer = null;
      checkBoundary();
      scheduleChecks();
    }, 50);
  }

  function onMedia(event) {
    validateIdentity();
    const current = loop;
    if (!current || current.video !== event.currentTarget) return;
    const video = current.video;
    if (event.type === "seeked") current.seeking = false;
    if (event.type === "play" || event.type === "playing") current.wasPlaying = true;
    if (event.type === "pause") {
      // An ended video pauses automatically; only resume that case, never an
      // explicit pause. Marking endpoints itself never calls play().
      if (!video.ended) current.wasPlaying = false;
      cancelChecks();
      return;
    }
    if (event.type === "ended") {
      cancelChecks();
      if (current.b != null && current.wasPlaying && !current.seeking) {
        try {
          seekRange(video, current.a, current.b);
          current.seeking = true;
          video.currentTime = current.a;
          video.play().catch(() => {
            if (loop === current) clearLoop("Playback stopped. Start the video and set the loop again.");
          });
        } catch (error) { clearLoop(error.message); }
      }
      return;
    }
    checkBoundary();
    scheduleChecks();
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
    validateIdentity();
    const video = primaryVideo();
    const selected = loop?.video === video ? loop : null;
    return { available: Boolean(video),
      rate: video?.playbackRate ?? desiredRate,
      savedRate: desiredRate,
      currentTime: video?.currentTime ?? null,
      bookmarkKey: selectedBookmarkKey(video),
      loop: { a: selected?.a ?? null, b: selected?.b ?? null, active: selected?.b != null,
        error: loopError } };
  }

  async function preferenceRequest(type, rate) {
    const response = await chrome.runtime.sendMessage({ target: "sitePreferences", type, rate });
    if (!response?.ok) throw new Error(response?.error || "Site preferences did not respond.");
    return response.result;
  }

  const ready = preferenceRequest("loadRate").then((preference) => {
    storageKey = preference.key;
    const value = pendingPreferences.has(storageKey) ? pendingPreferences.get(storageKey) : preference.rate;
    desiredRate = typeof value === "number" && Number.isFinite(value) ? normalize(value) : 1;
    pendingPreferences.clear();
    scan();
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList" || record.attributeName === "src")) scan();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true,
      attributes: true, attributeFilter: ["src"] });
    // Wait for the saved baseline before accepting a temporary override.
    globalThis.addEventListener("keydown", onHoldKey);
    globalThis.addEventListener("keyup", (event) => {
      if (event.code === "KeyR") stopAcceleration();
    }, true);
    globalThis.addEventListener("blur", stopAcceleration);
    globalThis.addEventListener("visibilitychange", () => {
      if (document.hidden) stopAcceleration();
    }, true);
    globalThis.addEventListener("focusin", (event) => {
      if (isTyping(event)) stopAcceleration();
    });
  });
  let chain = ready;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!storageKey) {
      for (const [key, change] of Object.entries(changes)) pendingPreferences.set(key, change.newValue);
      return;
    }
    if (!changes[storageKey]) return;
    const value = changes[storageKey].newValue;
    desiredRate = typeof value === "number" && Number.isFinite(value) ? normalize(value) : 1;
    // Other tabs keep their current speed. New videos use the latest preference.
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "video") return;
    const operation = chain.then(async () => {
      scan();
      if (message.type === "snapshot") return snapshot();
      if (message.type === "captureBookmark") return captureBookmark(message.key);
      if (message.type === "seekBookmark") return seekBookmark(message.key, message.time);
      if (message.type === "setLoopA") return setPoint("a");
      if (message.type === "setLoopB") return setPoint("b");
      if (message.type === "clearLoop") { clearLoop(); return snapshot(); }
      if (message.type !== "setRate" && message.type !== "adjustRate" && message.type !== "resetControls") {
        throw new Error("Unknown video control.");
      }
      if (message.type === "adjustRate" && (typeof message.delta !== "number" || !Number.isFinite(message.delta))) {
        throw new Error("Playback speed adjustment must be a finite number.");
      }
      stopAcceleration();
      if (message.type === "resetControls") clearLoop();
      const rate = normalize(message.type === "resetControls" ? 1
        : message.type === "adjustRate" ? snapshot().rate + message.delta : message.rate);
      const previousRate = desiredRate;
      const previousVideos = [...tracked].map((video) => ({
        video, rate: video.playbackRate, defaultRate: video.defaultPlaybackRate,
        preferredRate: rates.get(video), preservesPitch: video.preservesPitch,
      }));
      desiredRate = rate;
      try {
        for (const video of tracked) apply(video, rate);
        await preferenceRequest("saveRate", rate);
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
  for (const event of ["popstate", "hashchange", "pagehide"]) {
    globalThis.addEventListener(event, () => {
      stopAcceleration();
      clearLoop();
      for (const video of tracked) bookmarkSources.delete(video);
      notify();
    });
  }
  globalThis.addEventListener("pageshow", () => {
    scan();
    for (const video of tracked) rememberBookmarkSource(video);
    notify();
  });
  ready.catch((error) => console.error("Video controls:", error));
})();
