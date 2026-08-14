// Exchanges a stored long-lived refresh token for a short-lived access token.
// Env vars required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
async function getGoogleAccessToken(refreshToken) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google token refresh failed: " + (data.error_description || data.error || "unknown error"));
  return data.access_token;
}

module.exports = { getGoogleAccessToken };
