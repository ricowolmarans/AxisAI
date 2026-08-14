// POST /api/chat  { messages: [{role, content}, ...], provider: "openrouter"|"groq", model: "..." }
// Header required: Authorization: Bearer <supabase access token>
// Env vars required: OPENROUTER_API_KEY, GROQ_API_KEY
//
// Before asking the model anything, this pulls live context from whichever
// of the user's integrations are configured (Canvas to-dos, Slack DM list,
// recent Gmail subjects, recent Outlook subjects) and prepends it as a
// system message. Any source that isn't set up or fails just gets skipped —
// one bad source doesn't block the others or the chat itself.
const { supabaseAdmin, verifyUser } = require("./lib/supabaseAdmin");
const { getGoogleAccessToken } = require("./lib/google");
const { getMicrosoftAccessToken } = require("./lib/microsoft");

async function getCanvasContext(tokens) {
  const t = tokens.canvas;
  if (!t?.access_token || !t?.extra?.canvas_domain) return null;
  try {
    const res = await fetch(`https://${t.extra.canvas_domain}/api/v1/users/self/todo`, {
      headers: { Authorization: `Bearer ${t.access_token}` }
    });
    if (!res.ok) return `Canvas: couldn't fetch to-do items (status ${res.status}).`;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return "Canvas: no pending to-do items.";
    const items = data.slice(0, 8).map(i => `- ${i.assignment?.name || i.title || "Untitled"}${i.assignment?.due_at ? ` (due ${i.assignment.due_at})` : ""}`).join("\n");
    return `Canvas to-do items:\n${items}`;
  } catch (e) {
    return `Canvas: error fetching data (${e.message}).`;
  }
}

async function getSlackContext(tokens) {
  const t = tokens.slack;
  if (!t?.access_token) return null;
  try {
    const res = await fetch("https://slack.com/api/conversations.list?types=im", {
      headers: { Authorization: `Bearer ${t.access_token}` }
    });
    const data = await res.json();
    if (!data.ok) return `Slack: ${data.error}`;
    return `Slack: you have ${data.channels?.length || 0} open DM conversations.`;
  } catch (e) {
    return `Slack: error fetching data (${e.message}).`;
  }
}

async function getGmailContext(tokens) {
  const t = tokens.gmail;
  if (!t?.refresh_token) return null;
  try {
    const accessToken = await getGoogleAccessToken(t.refresh_token);
    const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const listData = await listRes.json();
    if (!listRes.ok) return `Gmail: ${listData.error?.message || "error fetching data"}`;

    const subjects = await Promise.all((listData.messages || []).map(async (m) => {
      const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const msgData = await msgRes.json();
      const headers = msgData.payload?.headers || [];
      return `- ${headers.find(h => h.name === "Subject")?.value || "(no subject)"} (from ${headers.find(h => h.name === "From")?.value || ""})`;
    }));
    return subjects.length ? `Recent Gmail subjects:\n${subjects.join("\n")}` : "Gmail: inbox is empty.";
  } catch (e) {
    return `Gmail: error fetching data (${e.message}).`;
  }
}

async function getGithubContext(tokens) {
  const t = tokens.github;
  if (!t?.access_token) return null;
  try {
    const res = await fetch("https://api.github.com/notifications?per_page=5", {
      headers: { Authorization: `Bearer ${t.access_token}`, Accept: "application/vnd.github+json" }
    });
    const data = await res.json();
    if (!res.ok) return `GitHub: ${data.message || "error fetching data"}`;
    if (!Array.isArray(data) || data.length === 0) return "GitHub: no unread notifications.";
    const items = data.map(n => `- [${n.repository?.full_name}] ${n.subject?.title} (${n.reason})`).join("\n");
    return `GitHub notifications:\n${items}`;
  } catch (e) {
    return `GitHub: error fetching data (${e.message}).`;
  }
}

async function getNotionContext(tokens) {
  const t = tokens.notion;
  if (!t?.access_token) return null;
  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json", "Notion-Version": "2022-06-28" },
      body: JSON.stringify({ page_size: 5, sort: { direction: "descending", timestamp: "last_edited_time" } })
    });
    const data = await res.json();
    if (!res.ok) return `Notion: ${data.message || "error fetching data"}`;
    const items = (data.results || []).map(p => {
      const title = p.properties?.title?.title?.[0]?.plain_text || p.properties?.Name?.title?.[0]?.plain_text || "Untitled";
      return `- ${title}`;
    });
    return items.length ? `Recently edited Notion pages:\n${items.join("\n")}` : "Notion: no recent pages found.";
  } catch (e) {
    return `Notion: error fetching data (${e.message}).`;
  }
}

async function getTeamsContext(tokens) {
  const t = tokens.microsoft;
  if (!t?.refresh_token) return null;
  try {
    const accessToken = await getMicrosoftAccessToken(t.refresh_token);
    const res = await fetch("https://graph.microsoft.com/v1.0/me/chats?$top=5&$orderby=lastUpdatedDateTime desc", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    // Missing-scope errors are common right after this feature ships — old
    // tokens don't have Chat.Read yet. Surface that clearly instead of a
    // generic Graph error so reconnecting is the obvious next step.
    if (!res.ok) return `Teams: ${data.error?.message || "error fetching data"}${data.error?.code === "Authorization_RequestDenied" ? " (try reconnecting Microsoft — this needs a newer permission grant)" : ""}`;
    const chats = (data.value || []).map(c => `- ${c.topic || c.chatType} (updated ${c.lastUpdatedDateTime})`);
    return chats.length ? `Recent Teams chats:\n${chats.join("\n")}` : "Teams: no recent chats.";
  } catch (e) {
    return `Teams: error fetching data (${e.message}).`;
  }
}

async function getOutlookContext(tokens) {
  const t = tokens.microsoft;
  if (!t?.refresh_token) return null;
  try {
    const accessToken = await getMicrosoftAccessToken(t.refresh_token);
    const res = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await res.json();
    if (!res.ok) return `Outlook: ${data.error?.message || "error fetching data"}`;
    const subjects = (data.value || []).map(m => `- ${m.subject || "(no subject)"} (from ${m.from?.emailAddress?.address || ""})`);
    return subjects.length ? `Recent Outlook subjects:\n${subjects.join("\n")}` : "Outlook: inbox is empty.";
  } catch (e) {
    return `Outlook: error fetching data (${e.message}).`;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: "Invalid JSON" }; }
  const { messages, provider = "openrouter", model, fileContext } = body;
  if (!Array.isArray(messages) || messages.length === 0 || !model) {
    return { statusCode: 400, body: JSON.stringify({ error: "messages (array) and model are required." }) };
  }

  let user, tokens = {};
  try {
    user = await verifyUser(event.headers.authorization);
    const { data, error } = await supabaseAdmin.from("integration_tokens").select("*").eq("user_id", user.id);
    if (error) throw new Error(error.message);
    (data || []).forEach(row => { tokens[row.service] = row; });
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: e.message }) };
  }

  const contextPieces = (await Promise.all([
    getCanvasContext(tokens),
    getSlackContext(tokens),
    getGmailContext(tokens),
    getOutlookContext(tokens),
    getTeamsContext(tokens),
    getGithubContext(tokens),
    getNotionContext(tokens)
  ])).filter(Boolean);

  // fileContext is a plain string the frontend builds from any files
  // attached to this message (zip listings, text previews, image
  // descriptions) — kept separate from the integrations pieces above since
  // it's per-message rather than per-conversation.
  if (fileContext) contextPieces.push(`Attached file(s):\n${fileContext}`);

  const contextBlock = contextPieces.length
    ? `Context from the user's connected sources (read-only — never suggest sending/replying anywhere):\n\n${contextPieces.join("\n\n")}`
    : "";

  const outboundMessages = contextBlock
    ? [{ role: "system", content: contextBlock }, ...messages]
    : messages;

  const endpoint = provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions";
  const key = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: `Missing ${provider === "groq" ? "GROQ_API_KEY" : "OPENROUTER_API_KEY"} env var.` }) };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: outboundMessages })
    });
    const data = await res.json();

    // Persist both sides of the exchange — brief also requires user + AI
    // messages saved to Supabase, which the frontend's chat.js already does
    // for the chat/messages tables; this endpoint just returns the reply.
    return {
      statusCode: res.status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        reply: data.choices?.[0]?.message?.content || data.error?.message || "No content returned.",
        usedContext: contextPieces.length > 0
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
