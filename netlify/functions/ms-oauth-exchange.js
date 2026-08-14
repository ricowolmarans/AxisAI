// POST /api/ms-oauth-exchange  { code }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI
//
// Unlike Google, Microsoft's identity platform doesn't support a zero-
// redirect popup trick — it needs a real redirect URI. public/ms-callback.html
// is that URI: a tiny static page on this same site that just relays the
// code back via postMessage and closes itself. One URL to register in Azure
// (your own deployed site + /ms-callback.html), nothing extra to host.
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
  if (!body.code) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing code." }) };

  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MS_CLIENT_ID,
        client_secret: process.env.MS_CLIENT_SECRET,
        code: body.code,
        grant_type: "authorization_code",
        redirect_uri: process.env.MS_REDIRECT_URI,
        scope: "offline_access Mail.Read User.Read"
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenData.error_description || "Microsoft didn't return a refresh token." }) };
    }

    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();
    const email = profile.mail || profile.userPrincipalName;

    await saveServiceToken(user.id, "microsoft", { refresh_token: tokenData.refresh_token, extra: { email } });
    await upsertConnectedAccount(user.id, "microsoft", { status: "connected", account_label: email, connected_at: new Date().toISOString() });
    await logSync(user.id, "microsoft", "success", "Connected via OAuth");

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ email }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
