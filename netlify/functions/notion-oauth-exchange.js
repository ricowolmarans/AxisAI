// POST /api/notion-oauth-exchange  { code }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: NOTION_CLIENT_ID, NOTION_CLIENT_SECRET
//
// Same redirect-based shape as github-oauth-exchange.js. public/notion-
// callback.html is the registered redirect URI. Notion's token endpoint
// wants Basic auth (client_id:client_secret), not form-encoded creds.
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
    const basicAuth = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64");
    const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}` },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: body.code,
        redirect_uri: process.env.NOTION_REDIRECT_URI
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: tokenData.error || "Notion didn't return an access token." }) };
    }

    const workspaceLabel = tokenData.workspace_name || "Notion workspace";

    // Notion tokens don't expire — no refresh_token to store.
    await saveServiceToken(user.id, "notion", {
      access_token: tokenData.access_token,
      extra: { workspace_id: tokenData.workspace_id, workspace_name: tokenData.workspace_name, bot_id: tokenData.bot_id }
    });
    await upsertConnectedAccount(user.id, "notion", { status: "connected", account_label: workspaceLabel, connected_at: new Date().toISOString() });
    await logSync(user.id, "notion", "success", "Connected via OAuth");

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ email: workspaceLabel }) };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
