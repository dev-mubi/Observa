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

      // Trigger Email Flow (Start of new incident)
      handleEmailNotification(user_email, image_path);
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


// Helper for Email Trigger (Simplified integration with existing logic)
function handleEmailNotification(email, imagePath) {
    // Reuse existing alert session logic?
    // For now, assume this is handled by Server Logic or kept simple:
    // If we want to keep the "Immediate Alert" email, we need the actual Image Data (Base64) or URL.
    // The WPF app uploads the file, so we have the URL/Path.
    // We can fetch the file or just send the link.
    // Let's rely on the existing /send-alert for EMAIL specifically (WPF calls both?)
    // Decision: WPF calls /log-event. Server handles emails.
    // But /log-event only gets the path.
    // We can generate a public URL and send that in the email HTML.
    
    // Future expansion: Send email here.
    console.log(`[INCIDENT] Started new incident for ${email}. Image: ${imagePath}`);
}



async function sendImmediateEmail(toEmail, frameImage, faceImage, timestamp, location) {
  console.log(`[EMAIL] 📧 Sending IMMEDIATE alert to ${toEmail}...`);

  try {
     const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 32px 24px; text-align: center;">
            <div style="background-color: rgba(255,255,255,0.15); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
              <span style="font-size: 32px;">🚨</span>
            </div>
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Security Alert</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 15px; font-weight: 500;">Immediate Attention Required</p>
          </div>

          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h2 style="color: #1a1a1a; margin: 0 0 16px 0; font-size: 22px; font-weight: 600; line-height: 1.3;">Person Detected at Monitor Location</h2>
            
            <p style="font-size: 16px; color: #4a4a4a; line-height: 1.7; margin: 0 0 24px 0;">
              Observa has detected a person in your monitored area. This alert was triggered automatically and includes photographic evidence for your review.
            </p>

            <!-- Info Card -->
            <div style="background: linear-gradient(to right, #fff5f5, #ffffff); border-left: 4px solid #dc3545; border-radius: 8px; padding: 20px; margin: 24px 0;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; font-size: 14px; color: #6c757d; font-weight: 500; width: 140px;">Detection Time</td>
                  <td style="padding: 8px 0; font-size: 14px; color: #1a1a1a; font-weight: 600;">${timestamp || new Date().toLocaleString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Location</td>
                  <td style="padding: 8px 0; font-size: 14px; color: #1a1a1a; font-weight: 600;">Monitor Camera</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Alert Type</td>
                  <td style="padding: 8px 0; font-size: 14px; color: #1a1a1a; font-weight: 600;">Person Detection</td>
                </tr>
              </table>
            </div>

            <!-- Snapshot Section -->
            <div style="margin: 28px 0;">
              <h3 style="color: #1a1a1a; margin: 0 0 12px 0; font-size: 17px; font-weight: 600;">Captured Evidence</h3>
              <div style="border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <img src="cid:frameImage" alt="Camera Snapshot" style="width: 100%; display: block; height: auto;" />
              </div>
            </div>

            ${faceImage ? `
            <div style="margin: 24px 0;">
              <h3 style="color: #1a1a1a; margin: 0 0 12px 0; font-size: 17px; font-weight: 600;">Detected Face</h3>
              <div style="border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); display: inline-block;">
                <img src="cid:faceImage" alt="Face Region" style="width: 200px; display: block; height: auto;" />
              </div>
            </div>
            ` : ""}

            <!-- Next Steps -->
            <div style="background-color: #fff9e6; border-radius: 8px; padding: 20px; margin: 28px 0 0 0; border-left: 4px solid #ffc107;">
              <p style="margin: 0; font-size: 15px; color: #856404; line-height: 1.7;">
                <strong style="font-weight: 600;">What's Next:</strong><br/>
                A summary report consolidating all detections during the next 3 minutes will be sent automatically. If this is expected activity, you can safely disregard this alert.
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #f8f9fa; padding: 24px; text-align: center; border-top: 1px solid #e9ecef;">
            <p style="margin: 0 0 12px 0; font-size: 15px; color: #495057; font-weight: 600;">Observa Security System</p>
            <p style="margin: 0 0 8px 0; font-size: 13px; color: #6c757d; line-height: 1.5;">Intelligent Surveillance for Your Peace of Mind</p>
            <p style="margin: 0; font-size: 11px; color: #adb5bd; line-height: 1.5;">
              This is an automated alert. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email logic extracted below to reuse transporter
    await sendEmailWithAttachments(toEmail, "🚨 Security Alert: Person Detected at Your Monitor", htmlContent, frameImage, faceImage);
    
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

  const startTimeStr = new Date(session.startTime).toLocaleTimeString();
  const endTimeStr = new Date().toLocaleTimeString();

  // Smart Photo Sampling - limit to max photos if too many events
  let sampledLogs = session.logs;
  let samplingApplied = false;
  
  if (session.logs.length > SAMPLING_CONFIG.MAX_PHOTOS_IN_SUMMARY) {
    samplingApplied = true;
    console.log(`[EMAIL] 🎯 Sampling ${SAMPLING_CONFIG.MAX_PHOTOS_IN_SUMMARY} photos from ${session.logs.length} events`);
    
    const first = session.logs[0];
    const last = session.logs[session.logs.length - 1];
    const middle = session.logs.slice(1, -1);  // Everything except first and last
    
    // Sample evenly from middle
    const middleSampleSize = SAMPLING_CONFIG.MAX_PHOTOS_IN_SUMMARY - 2;  // Reserve slots for first/last
    const sampledMiddle = [];
    
    if (middle.length > 0 && middleSampleSize > 0) {
      const step = middle.length / middleSampleSize;
      
      for (let i = 0; i < middleSampleSize; i++) {
        const index = Math.floor(i * step);
        if (index < middle.length) {
          sampledMiddle.push(middle[index]);
        }
      }
    }
    
    sampledLogs = [first, ...sampledMiddle, last];
    console.log(`[EMAIL] ✓ Sampled ${sampledLogs.length} photos (First + ${sampledMiddle.length} middle + Last)`);
  }

  // Build event list HTML with sampled snapshots
  let eventsHtml = '';
  const attachments = [];
  
  sampledLogs.forEach((log, index) => {
    const eventNum = index + 1;
    const eventTime = new Date(log.timestamp).toLocaleTimeString();
    
    // Create unique CID for each image
    const frameCid = `frame_${eventNum}`;
    const faceCid = `face_${eventNum}`;
    
    // Add frame snapshot attachment
    if (log.frameImage) {
      attachments.push({
        filename: `snapshot_${eventNum}.jpg`,
        content: log.frameImage.split("base64,")[1] || log.frameImage,
        encoding: "base64",
        cid: frameCid,
      });
    }
    
    // Add face image attachment
    if (log.faceImage) {
      attachments.push({
        filename: `face_${eventNum}.jpg`,
        content: log.faceImage.split("base64,")[1] || log.faceImage,
        encoding: "base64",
        cid: faceCid,
      });
    }
    
    eventsHtml += `
      <div style="border-top: 1px solid #dee2e6; padding: 18px 0; margin-top: 18px;">
        <h4 style="color: #333; margin: 0 0 12px 0; font-size: 15px; font-weight: 600;">Event ${eventNum} - ${eventTime}</h4>
        ${log.frameImage ? `<img src="cid:${frameCid}" alt="Snapshot ${eventNum}" style="width: 100%; max-width: 420px; border-radius: 6px; border: 2px solid #dee2e6; margin: 10px 0;" />` : ''}
        ${log.faceImage ? `<div style="margin-top: 12px;"><strong style="color: #555; font-size: 14px;">Detected Face Region:</strong><br/><img src="cid:${faceCid}" alt="Face ${eventNum}" style="width: 160px; border-radius: 6px; border: 2px solid #dee2e6; margin-top: 8px;" /></div>` : ''}
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
    <body style="margin: 0; padding: 20px; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #0f62fe 0%, #0353E9 100%); padding: 32px 24px; text-align: center;">
          <div style="background-color: rgba(255,255,255,0.15); width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(10px);">
            <span style="font-size: 32px;">📋</span>
          </div>
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Activity Summary</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 15px; font-weight: 500;">Aggregated Detection Report</p>
        </div>

        <!-- Content -->
        <div style="padding: 32px 24px;">
          <p style="font-size: 16px; color: #4a4a4a; line-height: 1.7; margin: 0 0 28px 0;">
            Following your initial alert at <strong>${startTimeStr}</strong>, Observa continued monitoring and detected <strong>${logCount} additional events</strong>. This summary consolidates all activity to keep you informed without overwhelming your inbox.
          </p>

          <!-- Stats Card -->
          <div style="background: linear-gradient(to right, #f0f7ff, #ffffff); border-radius: 12px; padding: 24px; margin: 24px 0;">
            <h3 style="color: #1a1a1a; margin: 0 0 16px 0; font-size: 18px; font-weight: 600;">Summary Statistics</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Monitoring Period</td>
                <td style="padding: 10px 0; font-size: 14px; color: #1a1a1a; font-weight: 600; text-align: right;">${startTimeStr} - ${endTimeStr}</td>
              </tr>
              <tr style="border-top: 1px solid #e9ecef;">
                <td style="padding: 10px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Total Detections</td>
                <td style="padding: 10px 0; font-size: 14px; color: #1a1a1a; font-weight: 600; text-align: right;">${logCount + 1} events</td>
              </tr>
              <tr style="border-top: 1px solid #e9ecef;">
                <td style="padding: 10px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Photos Included</td>
                <td style="padding: 10px 0; font-size: 14px; color: #1a1a1a; font-weight: 600; text-align: right;">${sampledLogs.length}${samplingApplied ? ` (sampled)` : ''}</td>
              </tr>
              <tr style="border-top: 1px solid #e9ecef;">
                <td style="padding: 10px 0; font-size: 14px; color: #6c757d; font-weight: 500;">Report Type</td>
                <td style="padding: 10px 0; font-size: 14px; color: #1a1a1a; font-weight: 600; text-align: right;">${samplingApplied ? 'Sampled' : 'Complete'}</td>
              </tr>
            </table>
          </div>

          <!-- Event Timeline -->
          <h3 style="color: #1a1a1a; margin: 32px 0 16px 0; font-size: 19px; font-weight: 600;">Detection Timeline</h3>
          ${eventsHtml}

          <!-- Info Box -->
          <div style="background-color: #e7f3ff; border-radius: 8px; padding: 20px; margin: 32px 0 0 0; border-left: 4px solid #0f62fe;">
            <p style="margin: 0; font-size: 15px; color: #004085; line-height: 1.7;">
              <strong style="font-weight: 600;">About This Report:</strong><br/>
              ${samplingApplied 
                ? `${sampledLogs.length} representative photos were selected from ${logCount} logged events across a ${Math.round((Date.now() - session.startTime) / 1000 / 60)}-minute period. Photos are evenly distributed to show activity patterns while keeping email size manageable.` 
                : `This report includes all ${logCount} detection events with complete photographic evidence.`}
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8f9fa; padding: 24px; text-align: center; border-top: 1px solid #e9ecef;">
          <p style="margin: 0 0 12px 0; font-size: 15px; color: #495057; font-weight: 600;">Observa Security System</p>
          <p style="margin: 0 0 8px 0; font-size: 13px; color: #6c757d; line-height: 1.5;">Intelligent Surveillance for Your Peace of Mind</p>
          <p style="margin: 0; font-size: 11px; color: #adb5bd; line-height: 1.5;">
            This is an automated summary. Please do not reply to this email.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
      const info = await transporter.sendMail({
        from: `"Observa Security" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: `📋 Activity Summary: ${logCount + 1} Detections Over ${Math.round((Date.now() - session.startTime) / 1000 / 60)} Minutes`,
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
