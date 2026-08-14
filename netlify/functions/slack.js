// GET /api/slack?method=conversations.list&types=im
// GET /api/slack?method=conversations.history&channel=D0123456
// Header required: Authorization: Bearer <supabase access token>
//
// Reading personal DMs needs a Slack USER token (xoxp-...) with im:history
// scope — a bot token can only see channels/DMs it's been explicitly added to.
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "slack");
    user = result.user;
    const token = result.token.access_token;

    if (!token) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Slack isn't set up yet — add your user token (xoxp-...) in Integrations." }) };
    }

    const method = event.queryStringParameters?.method || "auth.test";
    const params = new URLSearchParams(event.queryStringParameters || {});
    params.delete("method");

    const url = `https://slack.com/api/${method}${params.toString() ? "?" + params.toString() : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();

    await logSync(user.id, "slack", data.ok ? "success" : "error", data.ok ? null : data.error);
    if (!data.ok) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: data.error }) };
    return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
  } catch (e) {
    if (user) await logSync(user.id, "slack", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
