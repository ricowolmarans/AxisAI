// POST /api/analyze-file  { id }
// Header required: Authorization: Bearer <supabase access token>
// Env var required: GROQ_API_KEY
//
// Only meaningful for images right now — zip/text files already got their
// summary extracted synchronously in upload-file-finalize.js. Uses Groq's
// current vision model. NOTE: meta-llama/llama-4-scout and llama-4-maverick
// are both deprecated on Groq now (Feb/June 2026) — this was silently
// throwing on every image until swapped to qwen/qwen3.6-27b, Groq's current
// vision-capable model. It's listed as preview, not production — if Groq
// deprecates/promotes something new, check https://console.groq.com/docs/vision
const { verifyUser, supabaseAdmin, CORS } = require("./lib/supabaseAdmin");

const GROQ_VISION_MODEL = "qwen/qwen3.6-27b";

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
  if (!body.id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing id." }) };

  try {
    const { data: file, error: fetchError } = await supabaseAdmin
      .from("uploaded_files")
      .select("*")
      .eq("id", body.id)
      .eq("user_id", user.id)
      .single();
    if (fetchError || !file) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: "File not found." }) };

    if (file.kind !== "image") {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ summary: file.extracted_summary || "Nothing to analyze for this file type." }) };
    }

    const { data: signedUrlData, error: signError } = await supabaseAdmin.storage
      .from("uploads")
      .createSignedUrl(file.storage_path, 300);
    if (signError) throw new Error(signError.message);

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Describe this image in detail: what's shown, any visible text, and anything notable." },
            { type: "image_url", image_url: { url: signedUrlData.signedUrl } }
          ]
        }],
        max_tokens: 600
      })
    });
    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error(groqData.error?.message || "Groq vision request failed.");
    const summary = groqData.choices?.[0]?.message?.content || "No description returned.";

    await supabaseAdmin.from("uploaded_files").update({ extracted_summary: summary }).eq("id", file.id);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ summary }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
