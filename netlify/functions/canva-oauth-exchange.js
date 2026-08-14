// POST /api/canva-oauth-exchange  { code, codeVerifier }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: CANVA_CLIENT_ID, CANVA_CLIENT_SECRET
//
// Canva mandates PKCE — the frontend generates a code_verifier/challenge
// pair before opening the popup and must send the verifier back here so it
// can be exchanged alongside the code. Canva access tokens also expire
// (~4hrs) and issue a rotating refresh_token, unlike GitHub/Notion — both
// get stored so lib/canva.js can refresh on demand.
const { verifyUser, saveServiceToken, upsertConnectedAccount, logSync, CORS } = require("./lib/supabaseAdmin");

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
  if (!body.code || !body.codeVerifier) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing code or codeVerifier." }) };

  try {
    const basicAuth = Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch("https://api.canva.com/rest/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: body.code,
        code_verifier: body.codeVerifier,
        redirect_uri: process.env.CANVA_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenData.error_description || tokenData.error || "Canva didn't return an access token." }) };
    }

    const profileRes = await fetch("https://api.canva.com/rest/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json().catch(() => ({}));
    const label = profile.display_name || "Canva account";

    await saveServiceToken(user.id, "canva", {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      extra: { expires_at: Date.now() + (tokenData.expires_in || 14400) * 1000 }
    });
    await upsertConnectedAccount(user.id, "canva", { status: "connected", account_label: label, connected_at: new Date().toISOString() });
    await logSync(user.id, "canva", "success", "Connected via OAuth");

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ email: label }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
