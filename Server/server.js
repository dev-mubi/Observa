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
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/security-images/${image_path}`;
    
    const publicEvent = {
        ...newEvent,
        image_url: publicUrl
    };
    // Only send to the user's room
    io.to(user_email).emit('new-event', publicEvent);

    // TRIGGER EMAIL FLOW (Centralized)
    handleEmailTrigger(user_email, publicUrl, incidentId);

    res.json({ success: true, incidentId });

  } catch (error) {
    console.error("Log Event Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Email Logic handled here
function handleEmailTrigger(email, imageUrl, incidentId) {
    console.log(`[EMAIL] 📨 Processing trigger for ${email}...`);
    
    if (alertSessions.has(email)) {
        // Active session: Log for summary
        const session = alertSessions.get(email);
        session.logs.push({
            timestamp: new Date().toISOString(),
            frameImage: imageUrl // Store URL
        });
        console.log(`[EMAIL] 📸 Event logged to session (${session.logs.length} total)`);
    } else {
        // New Session -> Send Immediate Email
        console.log(`[EMAIL] 🚨 New session. Sending immediate alert.`);
        
        // Start Summary Timer (3 mins)
        const timer = setTimeout(() => {
            sendSummaryEmail(email);
        }, SAMPLING_CONFIG.COOLDOWN_DURATION);

        alertSessions.set(email, {
            startTime: Date.now(),
            timer: timer,
            logs: [{ timestamp: new Date().toISOString(), frameImage: imageUrl }],
            incidentId: incidentId
        });

        sendImmediateEmail(email, imageUrl, null, new Date().toLocaleString(), "Monitor Camera");
    }
}

async function sendImmediateEmail(toEmail, imageUrl, faceImage, timestamp, location) {
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
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
             <div style="padding: 32px 40px; border-bottom: 1px solid #f1f5f9;">
                  <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">Security Alert</h1>
                  <p style="margin: 8px 0 0 0; font-size: 14px; color: #64748b;">Person Detected at Monitor Location</p>
             </div>
             <div style="padding: 40px;">
                <p style="margin: 0 0 24px 0; font-size: 16px; color: #334155;">Observa has detected a person. See evidence below.</p>
                
                <div style="margin-bottom: 24px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                    <img src="${imageUrl}" alt="Evidence" style="width: 100%; display: block;" />
                </div>

                <div style="text-align: center; margin-top: 32px;">
                    <a href="${clientUrl}" style="background-color: #0f172a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">View Live Feed</a>
                </div>
             </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: `"Observa Security" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: "Security Alert: Person Detected",
      html: htmlContent
    });
    
  } catch (error) {
    console.error("[EMAIL] ❌ Failed to send immediate:", error);
  }
}

async function sendSummaryEmail(toEmail) {
  const session = alertSessions.get(toEmail);
  if (!session) return;
  alertSessions.delete(toEmail); 

  console.log(`[EMAIL] 📋 Sending SUMMARY to ${toEmail} (${session.logs.length} events)`);
  const clientUrl = "https://observa-client.vercel.app/";
  
  // Use first, middle, last photos (URL based)
  let photos = session.logs.map(l => l.frameImage).slice(0, 10); // Check limit

  let photosHtml = photos.map(url => `
    <div style="margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
        <img src="${url}" style="width: 100%; display: block;" />
    </div>
  `).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <body>
        <div style="max-width: 600px; margin: 0 auto; background: white; font-family: sans-serif; border: 1px solid #e2e8f0;">
            <div style="padding: 24px; border-bottom: 1px solid #f1f5f9;">
                <h1 style="margin: 0;">Activity Report</h1>
                <p style="color: #64748b;">${session.logs.length} Events Recorded</p>
            </div>
            <div style="padding: 24px;">
                ${photosHtml}
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${clientUrl}" style="background: #0f172a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Full History</a>
                </div>
            </div>
        </div>
    </body>
  `;

  try {
      await transporter.sendMail({
        from: `"Observa Security" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `Activity Report: ${session.logs.length} Events`,
        html: htmlContent
      });
  } catch (error) {
      console.error("[EMAIL] ❌ Failed summary:", error);
  }
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
