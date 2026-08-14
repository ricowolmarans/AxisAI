// GET /api/canva  (profile check / test connection)
// Header required: Authorization: Bearer <supabase access token>
// Handles refreshing the access token if it's expired — Canva tokens only
// last ~4 hours, unlike GitHub/Notion's non-expiring ones.
const { getServiceToken, saveServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");
const { refreshCanvaToken } = require("./lib/canva");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "canva");
    user = result.user;
    let token = result.token;

    if (!token.access_token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Canva isn't connected yet — hit Connect in Integrations." }) };
    }

    let accessToken = token.access_token;
    const expiresAt = token.extra?.expires_at || 0;
    if (Date.now() > expiresAt - 60000 && token.refresh_token) {
      const refreshed = await refreshCanvaToken(token.refresh_token);
      accessToken = refreshed.access_token;
      await saveServiceToken(user.id, "canva", {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token, // rotated — must overwrite
        extra: { expires_at: Date.now() + (refreshed.expires_in || 14400) * 1000 }
      });
    }

    const res = await fetch("https://api.canva.com/rest/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    await logSync(user.id, "canva", res.ok ? "success" : "error", res.ok ? null : (data.error || "error"));
    if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.error || "Canva API error" }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    if (user) await logSync(user.id, "canva", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
