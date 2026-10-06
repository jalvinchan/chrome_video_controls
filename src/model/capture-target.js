const BLOCKED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "edge:",
  "about:",
  "devtools:",
  "view-source:",
]);

export function captureRefusal(url) {
  if (typeof url !== "string" || url === "") return "Open a web page, then try again.";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "This page cannot be amplified.";
  }
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) return "This page cannot be amplified.";
  if (parsed.hostname === "chromewebstore.google.com") return "This page cannot be amplified.";
  return null;
}
