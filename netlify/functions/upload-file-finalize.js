// POST /api/upload-file-finalize  { storagePath, filename, mimeType, size }
// Header required: Authorization: Bearer <supabase access token>
//
// Step 2 of the direct-to-Storage upload flow. Called after the browser has
// already PUT the file straight into Supabase Storage via the signed URL
// from upload-file-init.js. Downloads it back (small files only — zip/text
// previews need the bytes) just enough to classify + summarize, then writes
// the uploaded_files row. This is the only function that still touches file
// bytes server-side, and only for the kinds that need a preview.
const { verifyUser, supabaseAdmin, CORS } = require("./lib/supabaseAdmin");
const { classifyFile, extractZipSummary } = require("./lib/fileProcessing");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };

  let user;
  try {
    user = await verifyUser(event.headers.authorization);
  } catch (e) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }
  const { storagePath, filename, mimeType, size } = body;
  if (!storagePath || !filename) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing storagePath or filename." }) };
  if (!storagePath.startsWith(`${user.id}/`)) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: "Not your file." }) };

  const kind = classifyFile(filename, mimeType);

  try {
    let extractedSummary = null;

    // Only pull bytes back down for kinds that actually need a text/zip
    // preview. Images are analyzed via vision in analyze-file.js; "other"
    // (pdf, docx, xlsx, binaries, etc.) gets a metadata-only summary below
    // instead of null — a null summary was silently getting the whole file
    // filtered out of the chat context on the frontend.
    if (kind === "zip" || kind === "text") {
      const { data: blob, error: dlError } = await supabaseAdmin.storage.from("uploads").download(storagePath);
      if (dlError) throw new Error(`Couldn't read back uploaded file: ${dlError.message}`);
      const buffer = Buffer.from(await blob.arrayBuffer());

      if (kind === "zip") {
        try {
          extractedSummary = extractZipSummary(buffer);
        } catch (e) {
          extractedSummary = `Couldn't parse this as a valid zip: ${e.message}`;
        }
      } else {
        extractedSummary = buffer.toString("utf8").slice(0, 4000);
      }
    } else if (kind === "other") {
      extractedSummary = `File "${filename}" (${mimeType || "unknown type"}, ${size ? `${Math.round(size / 1024)}KB` : "unknown size"}) was uploaded but this file type isn't previewed — mention its name/type to the user if relevant, no content is available.`;
    }
    // kind === "image": leave summary null, filled in by analyze-file.js.

    const { data: row, error: dbError } = await supabaseAdmin
      .from("uploaded_files")
      .insert({
        user_id: user.id,
        storage_path: storagePath,
        filename,
        mime_type: mimeType,
        size_bytes: size || null,
        kind,
        extracted_summary: extractedSummary
      })
      .select()
      .single();
    if (dbError) throw new Error(dbError.message);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ id: row.id, storagePath, kind, extractedSummary }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
