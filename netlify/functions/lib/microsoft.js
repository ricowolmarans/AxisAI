// Exchanges a stored Microsoft refresh token for a short-lived access token.
// Env vars required: MS_CLIENT_ID, MS_CLIENT_SECRET
async function getMicrosoftAccessToken(refreshToken) {
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "offline_access Mail.Read User.Read"
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Microsoft token refresh failed: " + (data.error_description || data.error || "unknown error"));
  return data.access_token;
}

module.exports = { getMicrosoftAccessToken };
