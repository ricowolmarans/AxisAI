// POST /api/upload-file-init  { filename, mimeType }
// Header required: Authorization: Bearer <supabase access token>
//
// Step 1 of the direct-to-Storage upload flow. Returns a short-lived signed
// upload URL so the browser can PUT the raw file straight into Supabase
// Storage — bypassing the Netlify Function body-size ceiling entirely
// (base64-through-the-function was inflating size ~33% and blowing past it
// on anything but tiny files). Nothing is written to the DB here; that
// happens in upload-file-finalize.js once the PUT succeeds.
const { verifyUser, supabaseAdmin, CORS } = require("./lib/supabaseAdmin");

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
  const { filename } = body;
  if (!filename) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing filename." }) };

  const storagePath = `${user.id}/${Date.now()}-${filename.replace(/[^\w.\-]/g, "_")}`;

  try {
    const { data, error } = await supabaseAdmin.storage
      .from("uploads")
      .createSignedUploadUrl(storagePath);
    if (error) throw new Error(`Couldn't create signed upload URL: ${error.message} (has the "uploads" bucket been created in Supabase Storage?)`);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ storagePath, signedUrl: data.signedUrl, token: data.token }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
