// GET /api/outlook  -> subject/from/date for the last 10 inbox messages
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: MS_CLIENT_ID, MS_CLIENT_SECRET
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");
const { getMicrosoftAccessToken } = require("./lib/microsoft");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "microsoft");
    user = result.user;
    const refreshToken = result.token.refresh_token;

    if (!refreshToken) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Microsoft isn't connected yet — hit 'Connect Microsoft' in Integrations." }) };
    }

    const accessToken = await getMicrosoftAccessToken(refreshToken);
    const res = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,from,receivedDateTime", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();

    if (!res.ok) {
      await logSync(user.id, "microsoft", "error", data.error?.message);
      return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || "Graph API error" }) };
    }

    const messages = (data.value || []).map(m => ({
      subject: m.subject || "(no subject)",
      from: m.from?.emailAddress?.address || "",
      date: m.receivedDateTime
    }));

    await logSync(user.id, "microsoft", "success", null);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ messages }) };
  } catch (e) {
    if (user) await logSync(user.id, "microsoft", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
