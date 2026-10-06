# Video Controls

A Chrome extension for local audio and standard HTML video controls.

## Features

- Local tab audio capture, gain control, and compression.
- Pitch-preserving video speed controls and keyboard shortcuts.
- A–B repeat for loaded, seekable video.
- Persistent timestamp bookmarks with optional notes.

## Install

Open `chrome://extensions`, enable Developer mode, and load this folder unpacked.
Pin the extension and open its popup on the current tab. Stop amplification before
reloading the extension. Audio stays in the browser and is not recorded or uploaded.

Video controls require a toolbar action or shortcut after every full page reload.
Only main-frame standard video elements are supported; custom players may override
settings. Media identities follow direct source URLs, with page URLs used for
unambiguous single-video blob sources.

## Development

Run `node --test` with Node.js 18 or newer. No dependency installation or build step
is required. Include tests and documentation with feature changes.

## License

[MIT](LICENSE).
