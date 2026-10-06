// The content script's site identity comes from Chrome, never a message URL.
export async function handleSitePreferenceMessage(preferences, message, sender) {
  if (sender.frameId !== 0) throw new Error("Site preferences require the main page.");
  if (message.type === "loadRate") return preferences.loadRate(sender.url);
  if (message.type === "saveRate") return preferences.saveRate(sender.url, message.rate);
  throw new Error("Unknown site preference action.");
}
