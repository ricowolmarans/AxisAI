// POST /api/google-oauth-exchange  { code }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//
// Uses Google's popup OAuth flow (redirect_uri: "postmessage"), so no
// callback URL needs registering — only an Authorized JavaScript origin.
//
// SECURITY NOTE: the refresh token is written straight to integration_tokens
// with the service_role client and never returned in the HTTP response. The
// browser only ever learns the email address back. Earlier versions of this
// function returned the refresh token to the client, which then wrote it
// itself — that meant the secret briefly existed in browser memory/network
// logs unnecessarily. This closes that gap.
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
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: body.code,
        grant_type: "authorization_code",
        redirect_uri: "postmessage"
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenData.error_description || "Google didn't return a refresh token — revoke access at myaccount.google.com/permissions and reconnect." }) };
    }

    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await profileRes.json();

    await saveServiceToken(user.id, "gmail", { refresh_token: tokenData.refresh_token, extra: { email: profile.email } });
    await upsertConnectedAccount(user.id, "gmail", { status: "connected", account_label: profile.email, connected_at: new Date().toISOString() });
    await logSync(user.id, "gmail", "success", "Connected via OAuth");

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ email: profile.email }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
