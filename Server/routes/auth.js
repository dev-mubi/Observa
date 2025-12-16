const express = require('express');
const router = express.Router();
const crypto = require("crypto");

// Import from server.js if needed (or we will move logic here)
// We need access to authSessions. Since it's in-memory, we must define it here 
// or import it if it was a singleton. 
// For cleaner refactor, we will move 'authSessions' to this file.

const authSessions = new Map();

// Helper: Generate secure random state
function generateState() {
  return crypto.randomBytes(32).toString("hex");
}

// Helper: Render Auth Page (Moved from server.js)
function renderAuthPage(status, title, message, details = null, autoClose = false) {
  const statusConfig = {
    success: { icon: "✓", iconColor: "#10b981", borderColor: "#10b981" },
    error: { icon: "✕", iconColor: "#ef4444", borderColor: "#ef4444" },
    warning: { icon: "⚠", iconColor: "#f59e0b", borderColor: "#f59e0b" },
  };

  const config = statusConfig[status] || statusConfig.error;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Sentinel Authentication</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
        .container { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); max-width: 560px; width: 100%; border-top: 3px solid ${config.borderColor}; }
        .header { padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e9ecef; }
        .status-icon { width: 64px; height: 64px; border-radius: 50%; background: #f8f9fa; border: 3px solid ${config.iconColor}; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; color: ${config.iconColor}; }
        .title { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
        .content { padding: 30px 40px; }
        .message { font-size: 16px; color: #495057; margin-bottom: 20px; text-align: center; }
        .details-box { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; padding: 16px; margin-top: 20px; }
        .error-code { font-family: monospace; color: #dc3545; background: #f8d7da; padding: 12px; border-radius: 4px; word-break: break-all; }
        .footer { padding: 20px; text-align: center; border-top: 1px solid #e9ecef; font-size: 12px; color: #adb5bd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="status-icon">${config.icon}</div>
          <h1 class="title">${title}</h1>
        </div>
        <div class="content">
          <p class="message">${message}</p>
          ${details ? details : ""}
        </div>
        <div class="footer">
          ${autoClose ? "This window will close automatically." : ""}
        </div>
      </div>
      ${autoClose ? `<script>setTimeout(() => window.close(), ${status === "success" ? 3000 : 5000});</script>` : ""}
    </body>
    </html>
  `;
}

// ==========================================
// 1. LEGACY ENDPOINTS (WPF / Popup Flow)
// ==========================================

/**
 * Endpoint: Initiate OAuth Login for WPF (Localhost Redirect)
 */
router.get("/login", (req, res) => {
  const state = generateState();
  const sessionId = generateState();

  // Use Localhost Callback
  const redirectUri = process.env.SENTINEL_REDIRECT_URI;

  authSessions.set(sessionId, {
    state: state,
    status: "pending",
    createdAt: Date.now(),
    redirectUri: redirectUri // Store ensuring we use the same one later
  });

  const params = new URLSearchParams({
    client_id: process.env.SENTINEL_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state: state,
  });

  const authUrl = `${process.env.SENTINEL_AUTH_URL}/oauth/login?${params}`;

  res.json({
    success: true,
    sessionId: sessionId,
    authUrl: authUrl,
    message: "Open this URL in browser to authenticate",
  });
});

/**
 * Endpoint: OAuth Callback (Server-Side Handler for Popup)
 */
router.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  // Find session
  let sessionId = null;
  let sessionData = null;
  for (const [id, session] of authSessions.entries()) {
    if (session.state === state) {
      sessionId = id;
      sessionData = session;
      break;
    }
  }

  if (!sessionId) {
    return res.send(renderAuthPage("error", "Invalid Session", "Session not found or expired.", null, true));
  }

  if (!code) {
    return res.send(renderAuthPage("error", "Missing Code", "No auth code received.", null, true));
  }

  try {
    // Exchange Token
    const redirectUri = sessionData.redirectUri || process.env.SENTINEL_REDIRECT_URI;
    
    const tokenResponse = await fetch(`${process.env.SENTINEL_API_URL}/api/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: code,
          client_id: process.env.SENTINEL_CLIENT_ID,
          client_secret: process.env.SENTINEL_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(tokenData.error || "Token exchange failed");
    }

    // Success: Update Session
    authSessions.set(sessionId, {
      ...authSessions.get(sessionId),
      status: "success",
      accessToken: tokenData.access_token,
      user: tokenData.user,
    });

    res.send(renderAuthPage("success", "Authentication Successful", "You can close this window now.", null, true));

  } catch (error) {
    authSessions.set(sessionId, { ...authSessions.get(sessionId), status: "error", error: error.message });
    res.send(renderAuthPage("error", "Authentication Error", error.message, null, true));
  }
});

/**
 * Endpoint: Check Token Status (for WPF Polling)
 */
router.get("/token-status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = authSessions.get(sessionId);

  if (!session) return res.status(404).json({ status: "not_found" });

  if (session.status === "success") {
    const data = { status: "success", accessToken: session.accessToken, user: session.user };
    authSessions.delete(sessionId); // Cleanup
    return res.json(data);
  }

  if (session.status === "error") {
    authSessions.delete(sessionId);
    return res.json({ status: "error", message: session.error });
  }

  res.json({ status: "pending" });
});


// ==========================================
// 2. NEW WEB ENDPOINTS (Client-Side Flow)
// ==========================================

/**
 * Endpoint: Initiate OAuth Login for Web (Production Redirect)
 */
router.get("/login-web", (req, res) => {
  // Use Web Redirect URI
  const redirectUri = process.env.SENTINEL_WEB_REDIRECT_URI;
  const state = generateState();

  // We don't necessarily need a session here if the client handles the flow,
  // but if we wanted to validate state on the backend, we should cache it.
  // For simplicity (and since client is managing redirect), we just return the URL.
  
  const params = new URLSearchParams({
    client_id: process.env.SENTINEL_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state: state,
  });

  const authUrl = `${process.env.SENTINEL_AUTH_URL}/oauth/login?${params}`;

  res.json({
    success: true,
    authUrl: authUrl,
    message: "Redirect user to this URL"
  });
});

/**
 * Endpoint: Exchange Code for Token (Called by Web Client)
 */
router.post("/api/auth/exchange", async (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ success: false, message: "Code required" });

  try {
    const redirectUri = process.env.SENTINEL_WEB_REDIRECT_URI;

    const tokenResponse = await fetch(`${process.env.SENTINEL_API_URL}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: code,
        client_id: process.env.SENTINEL_CLIENT_ID,
        client_secret: process.env.SENTINEL_CLIENT_SECRET,
        redirect_uri: redirectUri, // Must match the one used to get the code
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log("Web Exchange Result:", tokenData);

    if (!tokenResponse.ok) {
        return res.status(400).json({ success: false, message: tokenData.error || "Exchange failed" });
    }

    res.json({
      success: true,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      user: tokenData.user
    });

  } catch (error) {
    console.error("Exchange Error:", error);
    res.status(500).json({ success: false, message: "Internal server error during exchange" });
  }
});

// ==========================================
// 3. COMMON ENDPOINTS
// ==========================================

/**
 * Endpoint: Verify Token
 */
router.post("/verify-token", async (req, res) => {
    const { accessToken } = req.body;
  
    if (!accessToken) return res.status(400).json({ valid: false });
  
    try {
      const response = await fetch(`${process.env.SENTINEL_API_URL}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
  
      if (response.ok) {
        const userData = await response.json();
        res.json({ valid: true, user: userData });
      } else {
        res.json({ valid: false });
      }
    } catch (error) {
      res.status(500).json({ valid: false });
    }
  });


/**
 * Endpoint: Get User Info
 */
router.get("/user-info", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const token = authHeader.substring(7);

  try {
    const response = await fetch(`${process.env.SENTINEL_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    if (!response.ok) throw new Error("Failed to fetch user info");

    const userData = await response.json();
    res.json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to retrieve user info" });
  }
});

module.exports = router;
