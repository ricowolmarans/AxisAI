// GET /api/github?resource=notifications
// GET /api/github?resource=user/repos
// Header required: Authorization: Bearer <supabase access token>
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "github");
    user = result.user;
    const token = result.token.access_token;

    if (!token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "GitHub isn't connected yet — hit Connect in Integrations." }) };
    }

    const resource = event.queryStringParameters?.resource || "notifications";
    const url = `https://api.github.com/${resource}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    const data = await res.json();

    await logSync(user.id, "github", res.ok ? "success" : "error", res.ok ? null : (data.message || "error"));
    if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.message || "GitHub API error" }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    if (user) await logSync(user.id, "github", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
