const AdmZip = require("adm-zip");

const TEXT_EXTENSIONS = [".txt", ".md", ".json", ".js", ".ts", ".py", ".html", ".css", ".csv", ".yml", ".yaml", ".xml", ".log"];
const MAX_ZIP_ENTRIES_LISTED = 200;
const MAX_TEXT_PREVIEW_FILES = 8;
const MAX_TEXT_PREVIEW_CHARS_PER_FILE = 1500;
const MAX_TOTAL_PREVIEW_CHARS = 8000;

function classifyFile(filename, mimeType) {
  const lower = filename.toLowerCase();
  if ((mimeType || "").startsWith("image/")) return "image";
  if (lower.endsWith(".zip") || mimeType === "application/zip") return "zip";
  if (TEXT_EXTENSIONS.some(ext => lower.endsWith(ext)) || (mimeType || "").startsWith("text/")) return "text";
  return "other";
}

// Extracts a zip's file listing plus a capped text preview of the readable
// (non-binary) files inside it. Never writes to disk — everything happens
// on the in-memory Buffer, which keeps this safe to run inside a Netlify
// Function's short-lived, read-only-except-/tmp environment.
function extractZipSummary(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const listing = entries.slice(0, MAX_ZIP_ENTRIES_LISTED).map(e => `${e.isDirectory ? "[dir] " : ""}${e.entryName} (${e.header.size}b)`);
  const truncatedListing = entries.length > MAX_ZIP_ENTRIES_LISTED ? [...listing, `...and ${entries.length - MAX_ZIP_ENTRIES_LISTED} more`] : listing;

  let previewChars = 0;
  const previews = [];
  for (const entry of entries) {
    if (previews.length >= MAX_TEXT_PREVIEW_FILES || previewChars >= MAX_TOTAL_PREVIEW_CHARS) break;
    if (entry.isDirectory) continue;
    if (!TEXT_EXTENSIONS.some(ext => entry.entryName.toLowerCase().endsWith(ext))) continue;
    if (entry.header.size > 200_000) continue; // skip huge text files, not worth previewing
    try {
      const text = entry.getData().toString("utf8").slice(0, MAX_TEXT_PREVIEW_CHARS_PER_FILE);
      previews.push(`--- ${entry.entryName} ---\n${text}`);
      previewChars += text.length;
    } catch {
      // binary masquerading as a text extension, or unreadable — skip silently
    }
  }

  const summary = [
    `Zip contains ${entries.length} entries:`,
    truncatedListing.join("\n"),
    previews.length ? `\nText file previews:\n${previews.join("\n\n")}` : ""
  ].filter(Boolean).join("\n");

  return summary;
}

module.exports = { classifyFile, extractZipSummary };
