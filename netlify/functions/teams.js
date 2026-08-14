// GET  /api/teams?resource=chats                                    — list your Teams 1:1/group chats
// GET  /api/teams?resource=chat-messages&chatId=...                 — messages in one chat
// GET  /api/teams?resource=teams                                    — teams you're a member of
// GET  /api/teams?resource=channels&teamId=...                      — channels in a team
// GET  /api/teams?resource=channel-messages&teamId=...&channelId=...— messages in a channel
// POST /api/teams  { action: "send-chat-message", chatId, message }
// POST /api/teams  { action: "send-channel-message", teamId, channelId, message }
// Header required: Authorization: Bearer <supabase access token>
//
// Same Microsoft token as outlook.js — Teams data just needs the extra
// scopes (Chat.Read, ChannelMessage.Read.All, etc.) requested at connect
// time. Reconnect Microsoft if these calls 403 with "insufficient scope" —
// it means the token predates the scope change and needs a fresh consent.
const { getServiceToken, saveServiceToken, logSync, CORS } = require("./lib/supabaseAdmin");
const { getMicrosoftAccessToken } = require("./lib/microsoft");

async function withAccessToken(authHeader) {
  const { user, token } = await getServiceToken(authHeader, "microsoft");
  if (!token.refresh_token) throw new Error("Microsoft isn't connected yet — hit Connect in Integrations.");
  const accessToken = await getMicrosoftAccessToken(token.refresh_token);
  return { user, accessToken };
}

exports.handler = async (event) => {
  let user;
  try {
    if (event.httpMethod === "GET") {
      const result = await withAccessToken(event.headers.authorization);
      user = result.user;
      const { accessToken } = result;
      const resource = event.queryStringParameters?.resource || "chats";
      const qs = event.queryStringParameters || {};

      let url;
      if (resource === "chats") {
        url = "https://graph.microsoft.com/v1.0/me/chats?$top=20&$expand=members";
      } else if (resource === "chat-messages") {
        if (!qs.chatId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing chatId." }) };
        url = `https://graph.microsoft.com/v1.0/me/chats/${qs.chatId}/messages?$top=20`;
      } else if (resource === "teams") {
        url = "https://graph.microsoft.com/v1.0/me/joinedTeams";
      } else if (resource === "channels") {
        if (!qs.teamId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing teamId." }) };
        url = `https://graph.microsoft.com/v1.0/teams/${qs.teamId}/channels`;
      } else if (resource === "channel-messages") {
        if (!qs.teamId || !qs.channelId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing teamId or channelId." }) };
        url = `https://graph.microsoft.com/v1.0/teams/${qs.teamId}/channels/${qs.channelId}/messages?$top=20`;
      } else {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown resource: ${resource}` }) };
      }

      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = await res.json();
      await logSync(user.id, "microsoft", res.ok ? "success" : "error", res.ok ? null : (data.error?.message || "error"));
      if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || "Graph API error" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    }

    if (event.httpMethod === "POST") {
      const result = await withAccessToken(event.headers.authorization);
      user = result.user;
      const { accessToken } = result;

      let body;
      try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON" }) }; }
      if (!body.message) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing message." }) };

      let url;
      if (body.action === "send-chat-message") {
        if (!body.chatId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing chatId." }) };
        url = `https://graph.microsoft.com/v1.0/me/chats/${body.chatId}/messages`;
      } else if (body.action === "send-channel-message") {
        if (!body.teamId || !body.channelId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing teamId or channelId." }) };
        url = `https://graph.microsoft.com/v1.0/teams/${body.teamId}/channels/${body.channelId}/messages`;
      } else {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Unknown action: ${body.action}` }) };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ body: { content: body.message } })
      });
      const data = await res.json();
      await logSync(user.id, "microsoft", res.ok ? "success" : "error", res.ok ? null : (data.error?.message || "error"));
      if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: data.error?.message || "Graph API error" }) };
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    }

    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  } catch (e) {
    if (user) await logSync(user.id, "microsoft", "error", e.message);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
