# Video Controls

A Chrome extension for standard HTML video players: adjust speed, boost tab audio,
repeat a section, save timestamp bookmarks, and read existing or imported subtitles.
Audio processing and saved data stay in your browser. There are no external services
or build dependencies.

## Install

Requires Chrome 116 or newer.

1. Download or clone this repository.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Pin **Video Controls** and open its toolbar popup on a video page.

Open the popup or use an extension shortcut after each full page reload to enable
controls on that page. The extension requests access to the current tab through
`activeTab`; it does not run automatically on websites.

After updating, stop amplification, reload the extension, and reload video pages.

## Speed and temporary acceleration

Choose 0.25×–4× speed in 0.05× steps with the slider or number field, or use a preset.
Pitch preservation is enabled. Speed controls work independently of audio capture.

Hold **R** on the video page to temporarily use at least 3× speed, then release to
restore the actual previous rate. Typing fields, modified keys, and repeated
keydown events are ignored. Focus loss, navigation, source changes, or removal of
the video cancel the temporary rate. Temporary acceleration is never saved.

Standard video elements in the main page are supported. Players inside iframes,
live streams, browser pages, and players that override media settings have limitations.
Extreme rates may affect audio quality or buffering.

## Volume boost and site preferences

Choose **Amplify this tab** to capture and play the tab's audio through a local gain
control and compressor. The slider offers mute and gain from −5 dB to +20 dB in 5 dB steps.
Chrome displays a sharing indicator while amplification is active. **Stop**, or
closing the captured tab, releases capture and returns audio to Chrome.

One tab can be amplified at a time. Amplifying another tab switches capture to it.
Changing a different site's gain preference does not change the captured tab's audio.

Speed and gain are saved separately for each HTTP(S) hostname. Paths, ports, and
HTTP/HTTPS share preferences; subdomains have separate preferences. Sites without
a saved preference use previous global settings, or 1× and 0 dB on a fresh install.
Saving gain does not start capture. **Reset controls** saves 1× and 0 dB for the
current site and clears its loop; bookmarks and imported transcripts remain.

## A–B repeat

Expand **A–B repeat**. Choose **Set A**, move forward, and choose **Set B**. Reaching B
seeks back to A. B must follow A within one available seek range. **Clear loop**
removes both points. Marking points leaves an explicitly paused video paused.

The loop belongs to one video/source in one tab. Navigation, replacement, or source
changes clear it. Repeat is best effort: seek latency, browser scheduling, and
background throttling may cause overshoot. It is not frame-perfect or gapless.

## Timestamp bookmarks

Expand **Bookmarks**, enter an optional note, and choose **Save time**. Saved moments
appear in time order; click a line to jump or **Remove** to delete it. Notes are
limited to 250 characters, with up to 100 bookmarks per video. Notes render as text.

Bookmarks survive popup reopening, page reloads, and browser restarts. Direct video
sources use the HTTP(S) media URL as their identity. For a temporary blob source on
a single-video page, the page URL is used, retaining content parameters and hash
routes. Multiple videos sharing one page address may share a list; ambiguous blob
sources on multi-video pages are declined. Changing a media URL creates a separate list.

Jumps preserve pause, speed, pitch, and gain. Jumping outside an active loop clears
it; jumping within the loop retains it. Unloaded media, stale sources, live streams,
ongoing seeks, and unavailable seek ranges are declined.

## Transcript side panel

Choose **Transcript** in the popup. The panel follows the active tab in its Chrome
window. On a different page, open the toolbar popup to grant access and choose
**Refresh** if needed.

- Choose a native subtitle track or **Import SRT/VTT**. Full tracks include future
  lines immediately without advancing playback.
- Search text, click a timestamped line to jump, and enable **Follow playback** to
  scroll with current cues. Scrolling the list manually turns follow off.
- **Refresh** retains the selected track if it remains available.
- Imports stay local, are saved per video, and survive reopening/reloading. A new
  import replaces the previous one for that video; **Remove import** removes it.
- Files and normalized transcripts are limited to 2 MB and 20,000 lines. Invalid
  files and failed saves preserve the previous import.

Native tracks are read without changing caption visibility. A streaming player may
expose only loaded cues; the panel warns if it cannot establish a full file-backed
track. Custom caption renderers require an imported file. Imports appear in the
panel and are not overlaid on the video. Speech-to-text is not included.

## Shortcuts

| Action | Default shortcut |
| --- | --- |
| Increase/decrease speed | Alt + Shift + Right/Left |
| Amplify and increase/decrease gain | Alt + Shift + Up/Down |
| Temporary acceleration | Hold R on the video page |

On macOS, Alt is Option. Use the popup's **Shortcuts** button or
`chrome://extensions/shortcuts` to customize extension commands, including reset
and loop controls. Hold R is a page key, not an extension command.

## Privacy and permissions

Audio is processed locally without recording or uploading. Preferences, bookmarks,
notes, imported transcripts, and current capture state use local extension storage.
Native captions come from the page's existing tracks; no transcript service is called.

| Permission | Purpose |
| --- | --- |
| `activeTab`, `scripting` | Enable controls after a toolbar action or shortcut |
| `tabCapture`, `offscreen` | Process the amplified tab's audio in an offscreen document |
| `storage` | Save preferences, bookmarks, and imports |
| `sidePanel` | Display the transcript beside the video |

## Development

The extension runs directly from source without a bundler or package installation.
Run automated tests with Node.js 18 or newer:

```sh
node --test
```

See [architecture and contribution notes](docs/contributing.md) and
[manual browser checks](test/manual/README.md).

## License

[MIT](LICENSE).
