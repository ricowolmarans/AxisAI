// POST /api/upload-file  { filename, mimeType, contentBase64 }
// Header required: Authorization: Bearer <supabase access token>
//
// Stores the raw file in Supabase Storage under "<user_id>/<ts>-<filename>",
// then, for zips, extracts a file listing + text preview right away so the
// user (and chat.js) gets something useful without a second round trip.
// Images are stored as-is; analysis happens in analyze-file.js since it
// needs a real vision model call, not just parsing.
const { verifyUser, supabaseAdmin, CORS } = require("./lib/supabaseAdmin");
const { classifyFile, extractZipSummary } = require("./lib/fileProcessing");

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB — Netlify Functions have their own body-size ceiling anyway

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
  const { filename, mimeType, contentBase64 } = body;
  if (!filename || !contentBase64) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing filename or contentBase64." }) };

  const buffer = Buffer.from(contentBase64, "base64");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: `File too big — ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit.` }) };
  }

  const kind = classifyFile(filename, mimeType);
  const storagePath = `${user.id}/${Date.now()}-${filename.replace(/[^\w.\-]/g, "_")}`;

  try {
    const { error: uploadError } = await supabaseAdmin.storage
      .from("uploads")
      .upload(storagePath, buffer, { contentType: mimeType || "application/octet-stream", upsert: false });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message} (has the "uploads" bucket been created in Supabase Storage?)`);

    let extractedSummary = null;
    if (kind === "zip") {
      try {
        extractedSummary = extractZipSummary(buffer);
      } catch (e) {
        extractedSummary = `Couldn't parse this as a valid zip: ${e.message}`;
      }
    } else if (kind === "text") {
      extractedSummary = buffer.toString("utf8").slice(0, 4000);
    }

    const { data: row, error: dbError } = await supabaseAdmin
      .from("uploaded_files")
      .insert({
        user_id: user.id,
        storage_path: storagePath,
        filename,
        mime_type: mimeType,
        size_bytes: buffer.length,
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
