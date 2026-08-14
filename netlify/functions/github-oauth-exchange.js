// POST /api/github-oauth-exchange  { code }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
//
// GitHub's OAuth Apps need a real redirect (no popup postMessage trick like
// Google's). public/github-callback.html is that redirect target — same
// pattern as public/ms-callback.html. Register it once in your GitHub OAuth
// App settings as <your-site>/github-callback.html.
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
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: body.code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenData.error_description || "GitHub didn't return an access token." }) };
    }

    const profileRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" }
    });
    const profile = await profileRes.json();
    const login = profile.login || "GitHub user";

    // GitHub OAuth App tokens don't expire — no refresh_token to store.
    await saveServiceToken(user.id, "github", { access_token: tokenData.access_token, extra: { login, scope: tokenData.scope } });
    await upsertConnectedAccount(user.id, "github", { status: "connected", account_label: login, connected_at: new Date().toISOString() });
    await logSync(user.id, "github", "success", "Connected via OAuth");

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ email: login }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
