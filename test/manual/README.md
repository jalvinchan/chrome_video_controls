# Live video control checks

Serve this directory from the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory test/manual
```

Open `http://127.0.0.1:8765/bookmarks.html` in Chrome with Video Controls loaded.
This page fetches a public five-second MP4/WebM sample from MDN; internet access
to `interactive-examples.mdn.mozilla.net` is required. It does not inspect an account. It contains no extension code: open the real toolbar
popup to exercise the installed extension and its normal `activeTab` injection.

The page reports actual time, duration, pause, speed, pitch preservation, and
seekable ranges. Its seek buttons change time without starting playback.

1. Pause at 1 second. Save a bookmark with a distinctive test note.
2. Pause at 4 seconds and save another note. Confirm timestamp order.
3. Close/reopen the popup, then reload the page and reopen it. Both notes should
   remain. Open the popup after each full reload to enable controls on this site.
4. At 1× and 3×, jump between the bookmarks. Pause and pitch preservation should
   remain, and amplification should stay off. Also check during playback; this
   short sample ends quickly at 3×.
5. Set A at 1 second and B at 2 seconds. Jump to the 1-second bookmark: the loop
   should remain. Jump to 4 seconds: the loop should clear.
6. Use the other media source. It should have a separate list. Return to MP4
   and confirm the original list reappears.
7. Reset controls. Check 1×, 0 dB, no loop, and both saved bookmarks retained.
8. Exercise the speed shortcut with the popup open and its speed slider focused.
   The readout, slider, number field, and preset selection should update.
9. If you choose to remove test bookmarks, use their Remove buttons and check
   that other entries remain. Test notes persist in normal extension storage.

Stop the server with Ctrl+C when finished. These checks complement automated
tests; they do not cover Chrome restart persistence, simultaneous saves across
tabs, client-side navigation, live streams, or capture/audio behavior.

## Hold to accelerate

After reloading the extension and sample page, open the popup once to enable
controls, select 1.5×, then close it and focus the page.

1. Hold R: the sample's actual speed should show 3×. Release: it should show 1.5×.
   Repeat while paused and playing; pause and pitch preservation should stay intact.
2. Hold R long enough for keyboard repeats. Release and reopen the popup: the
   selected speed should still be 1.5×. At 4×, holding R should keep 4×.
3. Hold R, then switch tabs or windows before releasing. Return: speed should
   be restored. Try changing the media source while held; the new source should
   use the saved speed. Also check fullscreen in Chrome.
4. Focus a text field (such as a search field): R should type normally. Ctrl,
   Alt/Option, Command, and Shift combinations should not start acceleration.
5. With an A–B loop active, hold and release R: the loop should remain active,
   bookmarks should remain, and amplification should stay off.

## Transcript side panel

Open `http://127.0.0.1:8765/transcripts.html` using the server above. This public
sample has a local caption file, initially disabled. Stop amplification before
reloading the extension; reload the sample page after an extension reload.

1. Open the toolbar popup and choose **Transcript**. Both caption lines should
   appear while the video is paused at zero, including the future line.
2. Click the second line. The sample should report time 2.50 s, still paused,
   with the same playback rate and captions still disabled. Amplification stays off.
3. Import [transcript.srt](transcript.srt) from this directory. Its second line
   should appear immediately. Search for “future”, click that result, clear the
   search, and switch between imported and native tracks.
4. Close/reopen the panel and reload the sample page. Open the toolbar popup
   after a page reload to grant access. The saved import should return. Try
   importing [captions.vtt](captions.vtt) too, then an invalid file: a failed import
   must leave the previous saved copy usable.
5. Play/pause at 1× and 3×. Check current-line highlighting, follow scrolling,
   disabling Follow playback by scrolling manually, and clicking future lines.
6. Replace the video element and switch tabs. Old transcript loads must not
   appear in another video's panel; unavailable pages should offer an access
   explanation. Jumps must never seek the previous video after navigation.
7. **Remove import** should return to the native track and preserve bookmarks,
   speed, volume, and the original subtitle appearance.
