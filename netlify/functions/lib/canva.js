// Exchanges a stored Canva refresh token for a short-lived access token.
// Env vars required: CANVA_CLIENT_ID, CANVA_CLIENT_SECRET
//
// Unlike GitHub/Notion, Canva access tokens expire quickly (~4 hours) and
// refresh tokens ROTATE — every refresh returns a new refresh_token that
// must overwrite the old one, or the next refresh will fail. Callers of
// this function are expected to persist data.refresh_token if present.
async function refreshCanvaToken(refreshToken) {
  const basicAuth = Buffer.from(`${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Canva token refresh failed: " + (data.error_description || data.error || "unknown error"));
  return data; // { access_token, refresh_token, expires_in, ... } — refresh_token has rotated
}

module.exports = { refreshCanvaToken };
