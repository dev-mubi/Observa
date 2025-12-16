require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const cookieParser = require("cookie-parser");
const http = require("http");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const server = http.createServer(app);

// Initialize Supabase (Service Role for Admin Access)
// Note: Client-side should use Anon key, but Server needs Service Role for creating Signed URLs etc.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

  // Handle new connections
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // 1. Join User Room (Security)
    socket.on("join-room", (userEmail) => {
        if (userEmail) {
            socket.join(userEmail); // Join a room named after the email
            console.log(`Socket ${socket.id} joined room: ${userEmail}`);
        }
    });

    // 2. Handle Live Stream (WPF -> Server -> specific React Client)
    socket.on("broadcast-frame", (payload) => {
      // Debug Logging
      // console.log("Packet:", payload?.userEmail, "Size:", payload?.image?.length);
      
      if (payload && payload.userEmail && payload.image) {
          io.to(payload.userEmail).emit("live-frame", payload.image);
      } else {
          // Log malformed packets
          console.log("Malformed frame packet:", Object.keys(payload || {})); 
          // Check if it's the old format (raw string)?
          if (typeof payload === 'string') {
              console.log("Received legacy string frame. Dropping due to security.");
          }
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: true, // Allow all origins for now (simplifies deployment)
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));
app.use(express.json({ limit: '7mb' }));
app.use(express.urlencoded({ limit: '7mb', extended: true }));
app.use(cookieParser());

// Authentication Routes (Refactored)
app.use('/', require('./routes/auth'));

// Email Transporter Configuration
const transporter = nodemailer.createTransport({
  service: "gmail", // Requesting Gmail service by default; user can configure valid SMTP params
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Endpoint 6: Send Security Alert Email
 */
app.post("/send-alert", async (req, res) => {
  const { toEmail, frameImage, faceImage, timestamp, location } = req.body;

  if (!toEmail || !frameImage) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields (toEmail, frameImage)",
    });
  }

  // Rate Limiting Logic (Server-Side)
  // Check for existing alert session for this user
  if (alertSessions.has(toEmail)) {
    // Session active: Smart sampling - only log if enough time has passed
    const session = alertSessions.get(toEmail);
    const now = Date.now();
    
    // Smart sampling: only log if enough time has passed since last log
    const shouldLog = !session.lastLoggedTime || 
                      (now - session.lastLoggedTime >= SAMPLING_CONFIG.MIN_TIME_BETWEEN_LOGS);
    
    if (shouldLog) {
      session.logs.push({
        timestamp: timestamp || new Date().toISOString(),
        location: location,
        frameImage: frameImage,  // Store snapshot for summary email
        faceImage: faceImage     // Store face for summary email
      });
      session.lastLoggedTime = now;  // Track last logged time
      
      const timeSinceStart = ((now - session.startTime) / 1000).toFixed(1);
      console.log(`[EMAIL] 📸 Event logged (${session.logs.length} total, ${timeSinceStart}s since incident start)`);
    } else {
      const timeSinceLastLog = ((now - session.lastLoggedTime) / 1000).toFixed(1);
      console.log(`[EMAIL] ⏭️ Event skipped (too soon, ${timeSinceLastLog}s since last log, need ${SAMPLING_CONFIG.MIN_TIME_BETWEEN_LOGS/1000}s)`);
    }
    
    return res.json({ 
      success: true, 
      message: shouldLog ? "Event logged" : "Event skipped (sampling active)",
      logsCount: session.logs.length 
    });
  }

  // No active session: This is a NEW incident
  console.log(`[EMAIL] 🚨 New incident for ${toEmail}. Sending immediate alert & starting 5min summary timer.`);

  // 1. Create Session & Timer FIRST (prevents race condition)
  const timer = setTimeout(() => {
    sendSummaryEmail(toEmail);
  }, SAMPLING_CONFIG.COOLDOWN_DURATION); // Use config value (3 minutes)

  alertSessions.set(toEmail, {
    startTime: Date.now(),
    timer: timer,
    logs: [],            // Will collect SUBSEQUENT alerts
    lastLoggedTime: null // Track when we last logged an event (for sampling)
  });

  // 2. Send Immediate Alert (async, but session already exists)
  sendImmediateEmail(toEmail, frameImage, faceImage, timestamp, location);

  return res.json({ success: true, message: "Immediate alert sent, aggregation started" });
});

// Store alert sessions: Map<email, { startTime, timer, logs: [] }>
const alertSessions = new Map();

// Smart Sampling Configuration
const SAMPLING_CONFIG = {
  MIN_TIME_BETWEEN_LOGS: 10000,        // 10 seconds minimum between logged events
  MAX_PHOTOS_IN_SUMMARY: 12,           // Maximum 12 photos per summary email
  COOLDOWN_DURATION: 3 * 60 * 1000     // 3 minutes cooldown
};


/**
 * Endpoint 7: Generate Signed Upload URL (For WPF Client)
 */
app.post("/api/generate-upload-url", async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, message: "Filename required" });

  try {
    const { data, error } = await supabase
      .storage
      .from('security-images')
      .createSignedUploadUrl(filename);

    if (error) throw error;

    res.json({
      success: true,
      uploadUrl: data.signedUrl,
      path: data.path, // Store this in DB
      publicUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/security-images/${data.path}`
    });
  } catch (error) {
    console.error("Upload URL Generation Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Endpoint 8: Log Event (Supabase + Incidents)
 */
app.post("/api/log-event", async (req, res) => {
  const { user_email, image_path, timestamp, confidence } = req.body;

  try {
    // 1. Check for Active Incident
    const { data: activeIncident } = await supabase
      .from('incidents')
      .select('*')
      .eq('user_email', user_email)
      .eq('status', 'active')
      .single();

    let incidentId;
    let createNew = true;

    if (activeIncident) {
      // Check time since last event for this incident
      // We can check 'start_time' or query the latest security_event
      // Let's query the latest event for this incident
      const { data: lastEvent } = await supabase
        .from('security_events')
        .select('timestamp')
        .eq('incident_id', activeIncident.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

      const lastTime = lastEvent ? new Date(lastEvent.timestamp).getTime() : new Date(activeIncident.start_time).getTime();
      const now = new Date().getTime();
      const diffMinutes = (now - lastTime) / 1000 / 60;

      if (diffMinutes > 3) {
         // Gap detected (> 3 mins). Close old incident.
         await supabase
           .from('incidents')
           .update({ 
             status: 'completed', 
             end_time: new Date(lastTime).toISOString() // End time is the last detected motion
           })
           .eq('id', activeIncident.id);
         
         createNew = true;
         // Send summary email for the CLOSED incident here if needed
      } else {
         // Continue existing incident
         incidentId = activeIncident.id;
         createNew = false;
         
         await supabase
          .from('incidents')
          .update({ total_events: activeIncident.total_events + 1 })
          .eq('id', incidentId);
      }
    }

    if (createNew) {
      // NEW INCIDENT
      const { data: newIncident, error: incError } = await supabase
        .from('incidents')
        .insert({
          user_email,
          start_time: new Date(),
          status: 'active',
          total_events: 1
        })
        .select()
        .single();
        
      if (incError) throw incError;
      incidentId = newIncident.id;

      if (incError) throw incError;
      incidentId = newIncident.id;
    }

    // 2. Insert Event
    const { data: newEvent, error: eventError } = await supabase
      .from('security_events')
      .insert({
        user_email,
        incident_id: incidentId,
        image_url: image_path,
        timestamp: timestamp || new Date(),
        location: 'Monitor Camera'
      })
      .select()
      .single();

    if (eventError) throw eventError;

    // BROADCAST TO FRONTEND (Securely)
    const publicEvent = {
        ...newEvent,
        image_url: `${process.env.SUPABASE_URL}/storage/v1/object/public/security-images/${image_path}`
    };
    // Only send to the user's room
    io.to(user_email).emit('new-event', publicEvent);

    res.json({ success: true, incidentId });

  } catch (error) {
    console.error("Log Event Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Endpoint 9: Get Events History
 */
app.get("/api/events", async (req, res) => {
  const { user_email } = req.query; // Authenticated user
  
  try {
    const { data: incidents, error } = await supabase
      .from('incidents')
      .select(`
        *,
        security_events (
          id,
          image_url,
          timestamp
        )
      `)
      .eq('user_email', user_email) 
      .order('start_time', { ascending: false })
      .limit(20);

    if (error) throw error;

    // Transform for UI: Fix image URLs to be full public URLs
    const events = incidents.map(inc => ({
      ...inc,
      security_events: inc.security_events.map(ev => ({
        ...ev,
        image_url: ev.image_url.startsWith('http') ? ev.image_url : `${process.env.SUPABASE_URL}/storage/v1/object/public/security-images/${ev.image_url}`
      }))
    }));

    res.json({ success: true, events });
  } catch (error) {
      res.status(500).json({ success: false, message: error.message });
  }
});


// Email Logic is now fully handled by /send-alert endpoint
// This ensures centralized session management and sampling.



async function sendImmediateEmail(toEmail, frameImage, faceImage, timestamp, location) {
  console.log(`[EMAIL] 📧 Sending IMMEDIATE alert to ${toEmail}...`);

  const clientUrl = "https://observa-client.vercel.app/";

  try {
     const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc;">
          <tr>
            <td align="center" style="padding: 40px 20px;">
              <div style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                
                <!-- Header -->
                <div style="background-color: #ffffff; padding: 32px 40px; border-bottom: 1px solid #f1f5f9;">
                  <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">Security Alert</h1>
                  <p style="margin: 8px 0 0 0; font-size: 14px; color: #64748b;">Person Detected at Monitor Location</p>
                </div>

                <!-- Content -->
                <div style="padding: 40px;">
                  <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                    Observa has detected a person in your monitored area. This automated alert includes photographic evidence captured at the time of the event.
                  </p>

                  <!-- Key Info -->
                  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 20px; margin-bottom: 32px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding-bottom: 8px; font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Timestamp</td>
                        <td style="padding-bottom: 8px; font-size: 14px; font-weight: 500; color: #0f172a; text-align: right;">${timestamp || new Date().toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td style="font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">Location</td>
                        <td style="font-size: 14px; font-weight: 500; color: #0f172a; text-align: right;">Monitor Camera</td>
                      </tr>
                    </table>
                  </div>

                  <!-- Evidence -->
                  <div style="margin-bottom: 32px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Captured Evidence</h3>
                    <div style="border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0;">
                      <img src="cid:frameImage" alt="Camera Snapshot" style="width: 100%; display: block; height: auto;" />
                    </div>
                  </div>

                  ${faceImage ? `
                  <div style="margin-bottom: 32px;">
                    <h3 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Detected Face</h3>
                    <div style="border-radius: 6px; overflow: hidden; border: 1px solid #e2e8f0; display: inline-block;">
                      <img src="cid:faceImage" alt="Face Region" style="width: 150px; display: block; height: auto;" />
                    </div>
                  </div>
                  ` : ""}

                  <!-- Primary Action -->
                  <div style="text-align: center; margin: 40px 0;">
                    <a href="${clientUrl}" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; display: inline-block;">View Live Feed</a>
                  </div>

                  <p style="margin: 0; font-size: 14px; color: #64748b; text-align: center;">
                    Please log in to your dashboard to view the live stream.
                  </p>
                </div>

                <!-- Footer -->
                <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #475569;">Observa Security</p>
                  <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                    Automated Alert System • Do not reply
                  </p>
                </div>
              </div>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Send email logic extracted below to reuse transporter
    await sendEmailWithAttachments(toEmail, "Security Alert: Person Detected", htmlContent, frameImage, faceImage);
    
  } catch (error) {
    console.error("[EMAIL] ❌ Failed to send immediate email:", error);
    // Don't crash request handler, just log
  }
}

async function sendSummaryEmail(toEmail) {
  const session = alertSessions.get(toEmail);
  if (!session) return;

  alertSessions.delete(toEmail); // Clear session
  
  const logCount = session.logs.length;
  if (logCount === 0) {
      console.log(`[EMAIL] ℹ️ Summary timer ended for ${toEmail}, but no additional alerts occurred.`);
      return;
  }

  console.log(`[EMAIL] 📋 Sending SUMMARY email to ${toEmail} for ${logCount} aggregated events...`);

  const clientUrl = "https://observa-client.vercel.app/";
  const startTimeStr = new Date(session.startTime).toLocaleTimeString();
  const endTimeStr = new Date().toLocaleTimeString();

  // Smart Photo Sampling - limit to max photos if too many events
  let sampledLogs = session.logs;
  let samplingApplied = false;
  
  if (session.logs.length > SAMPLING_CONFIG.MAX_PHOTOS_IN_SUMMARY) {
    samplingApplied = true;
    
    const first = session.logs[0];
    const last = session.logs[session.logs.length - 1];
    const middle = session.logs.slice(1, -1);
    
    // Sample evenly from middle
    const middleSampleSize = SAMPLING_CONFIG.MAX_PHOTOS_IN_SUMMARY - 2;
    const sampledMiddle = [];
    
    if (middle.length > 0 && middleSampleSize > 0) {
      const step = middle.length / middleSampleSize;
      for (let i = 0; i < middleSampleSize; i++) {
        const index = Math.floor(i * step);
        if (index < middle.length) sampledMiddle.push(middle[index]);
      }
    }
    sampledLogs = [first, ...sampledMiddle, last];
  }

  // Build event list HTML with sampled snapshots
  let eventsHtml = '';
  const attachments = [];
  
  sampledLogs.forEach((log, index) => {
    const eventNum = index + 1;
    const eventTime = new Date(log.timestamp).toLocaleTimeString();
    
    const frameCid = `frame_${eventNum}`;
    const faceCid = `face_${eventNum}`;
    
    if (log.frameImage) {
      attachments.push({ filename: `snapshot_${eventNum}.jpg`, content: log.frameImage.split("base64,")[1] || log.frameImage, encoding: "base64", cid: frameCid });
    }
    
    if (log.faceImage) {
      attachments.push({ filename: `face_${eventNum}.jpg`, content: log.faceImage.split("base64,")[1] || log.faceImage, encoding: "base64", cid: faceCid });
    }
    
    eventsHtml += `
      <div style="border-top: 1px solid #e2e8f0; padding: 20px 0; margin-top: 20px;">
        <div style="margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #334155;">
          Event at ${eventTime}
        </div>
        ${log.frameImage ? `<img src="cid:${frameCid}" alt="Snapshot ${eventNum}" style="width: 100%; max-width: 400px; border-radius: 4px; border: 1px solid #e2e8f0; display: block; margin-bottom: 12px;" />` : ''}
        ${log.faceImage ? `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase;">Face Detected</span>
            <img src="cid:${faceCid}" alt="Face ${eventNum}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid #e2e8f0;" />
          </div>` 
        : ''}
      </div>
    `;
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc;">
        <tr>
          <td align="center" style="padding: 40px 20px;">
            <div style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              
              <!-- Header -->
              <div style="background-color: #ffffff; padding: 32px 40px; border-bottom: 1px solid #f1f5f9;">
                <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">Activity Report</h1>
                <p style="margin: 8px 0 0 0; font-size: 14px; color: #64748b;">Aggregated Detections Summary</p>
              </div>

              <!-- Content -->
              <div style="padding: 40px;">
                <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #334155;">
                  The monitoring session has concluded. Observa recorded <strong>${logCount + 1} total events</strong> between <strong>${startTimeStr}</strong> and <strong>${endTimeStr}</strong>.
                </p>

                <!-- Stats Grid -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px;">
                  <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0;">
                      <div style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase;">Duration</div>
                      <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px;">${Math.round((Date.now() - session.startTime) / 1000 / 60)} min</div>
                  </div>
                  <div style="background-color: #f8fafc; padding: 16px; border-radius: 6px; border: 1px solid #e2e8f0;">
                      <div style="font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase;">Events</div>
                      <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 4px;">${logCount + 1}</div>
                  </div>
                </div>

                <!-- Timeline -->
                <h3 style="margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">Event Timeline</h3>
                ${eventsHtml}
                
                ${samplingApplied ? `<p style="font-size: 13px; color: #64748b; font-style: italic; margin-top: 16px;">* Showing ${sampledLogs.length} representative events from total.</p>` : ''}

                <!-- Primary Action -->
                <div style="text-align: center; margin: 40px 0;">
                  <a href="${clientUrl}" style="background-color: #ffffff; color: #0f172a; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px; display: inline-block; border: 1px solid #e2e8f0;">View Full History</a>
                </div>
              </div>

              <!-- Footer -->
              <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px; text-align: center;">
                <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #475569;">Observa Security</p>
                <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                  Activity Report • ${new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
      const info = await transporter.sendMail({
        from: `"Observa Security" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Activity Report: ${logCount + 1} Events Recorded`,
        html: htmlContent,
        attachments: attachments,
      });
      console.log(`[EMAIL] ✓ Summary email sent to ${toEmail} with ${attachments.length} images`);
  } catch (error) {
      console.error("[EMAIL] ❌ Failed to send summary email:", error);
  }
}

async function sendEmailWithAttachments(to, subject, html, frameImage, faceImage) {
    const attachments = [];
    if (frameImage) {
      attachments.push({
        filename: "snapshot.jpg",
        content: frameImage.split("base64,")[1] || frameImage,
        encoding: "base64",
        cid: "frameImage",
      });
    }
    if (faceImage) {
      attachments.push({
        filename: "face.jpg",
        content: faceImage.split("base64,")[1] || faceImage,
        encoding: "base64",
        cid: "faceImage",
      });
    }

    const info = await transporter.sendMail({
      from: `"Observa Security" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
      attachments: attachments,
    });
    return info;
}


// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║                                                           ║");
  console.log("║       🔐 Sentinel OAuth Server Running                   ║");
  console.log("║                                                           ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(
              `║  Port:          ${PORT}                                     ║`
  );
  console.log(
    `║  Environment:   ${process.env.NODE_ENV}                            ║`
  );
  console.log("║  Health Check:  http://localhost:5000/health             ║");
  console.log("║                                                           ║");
  console.log("║  Endpoints:                                               ║");
  console.log("║  • GET  /login            - Start OAuth flow             ║");
  console.log("║  • GET  /callback         - OAuth callback               ║");
  console.log("║  • GET  /token-status/:id - Check auth status            ║");
  console.log("║  • POST /verify-token     - Verify access token          ║");
  console.log("║  • GET  /user-info        - Get user profile             ║");
  console.log("║                                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("✅ Ready to accept authentication requests from WPF app");
  console.log("");
});
