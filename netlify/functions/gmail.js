// GET /api/gmail  -> subject/from/date for the last 10 inbox messages
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
const { getServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");
const { getGoogleAccessToken } = require("./lib/google");

exports.handler = async (event) => {
  let user;
  try {
    const result = await getServiceToken(event.headers.authorization, "gmail");
    user = result.user;
    const refreshToken = result.token.refresh_token;

    if (!refreshToken) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Gmail isn't connected yet — hit 'Connect Gmail' in Integrations." }) };
    }

    const accessToken = await getGoogleAccessToken(refreshToken);

    const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const listData = await listRes.json();
    if (!listRes.ok) {
      await logSync(user.id, "gmail", "error", listData.error?.message);
      return { statusCode: listRes.status, headers: CORS, body: JSON.stringify({ error: listData.error?.message || "Gmail API error" }) };
    }

    const messages = await Promise.all((listData.messages || []).map(async (m) => {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      return {
        subject: headers.find(h => h.name === "Subject")?.value || "(no subject)",
        from: headers.find(h => h.name === "From")?.value || "",
        date: msgData.internalDate ? new Date(Number(msgData.internalDate)).toISOString() : null
      };
    }));

    await logSync(user.id, "gmail", "success", null);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ messages }) };
  } catch (e) {
    if (user) await logSync(user.id, "gmail", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
