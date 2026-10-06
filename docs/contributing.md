# Contributing

The extension uses Chrome Manifest V3, browser ES modules, and a self-contained
classic content script. There is no build step or third-party runtime dependency.

## Responsibilities

- `src/entrypoint/background.js` receives extension messages and owns the audio
  controller and storage repositories.
- `src/entrypoint/video.js` owns media selection, playback settings, temporary hold,
  A–B repeat, source identities, bookmark seeks, and native text-track reads.
- `src/video/chrome-video-stage.js` injects the video script after an explicit user
  action and sends commands to the main frame. Native track reads run outside the
  playback-command queue so network loading cannot freeze controls.
- `src/app/popup-sync.js` updates the popup from events rather than continuous polling.
- `src/app/transcript-panel.js` owns active-tab changes, imports, stale-read rejection,
  and timeline polling while the side panel is visible.
- `src/presentation/` renders controls and transcript text. Caption text and bookmark
  notes are rendered through text nodes, never inserted as executable markup.
- `src/storage/` and `src/transcript/` own persisted settings, bookmark records,
  transcript parsing, and native-caption source validation.
- `src/core/audio-graph.js` owns the local gain and compressor graph; the offscreen
  document keeps the audio session independent of popup lifetime.

## Changes and validation

Keep media state in the video script and capture state in the audio controller.
Re-use existing identity and seek validation for new timeline features. Preserve
explicit pause, pitch, gain, and per-tab ownership when changing playback behavior.

Include regression coverage for source transitions, persistence failures, and
asynchronous context changes. Keep tests and relevant documentation with the feature
commit. Historical development notes and experiments belong outside this repository.

Run `node --test` and `git diff --check`. Load the extension unpacked and follow
[the browser checklist](../test/manual/README.md) for changes to media or UI behavior.
Tests use Node's built-in runner and isolated Chrome/media fakes. They cannot establish
compatibility with every custom player, browser scheduling behavior, or capture device.

## Compatibility

Chrome 116 or newer is required for offscreen tab audio capture. No persistent host
permissions or automatic website injection are configured. Each full page reload
requires a toolbar action or shortcut to grant current-tab access again.

Only main-frame standard video elements and native text tracks are supported.
Seek operations require loaded finite-duration media and an available seek range.
Repeat is best effort, and changing source URLs can change bookmark/import identity.
