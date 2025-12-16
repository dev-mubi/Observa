using Emgu.CV;
using Emgu.CV.CvEnum;
using Emgu.CV.Structure;
using Emgu.CV.Util;
using SentinelIntrusionDetection.Models;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SocketIOClient;

namespace SentinelIntrusionDetection.Services
{
    public class LocalVisionService : IVisionService, IDisposable
    {
        private VideoCapture? _videoCapture;
        private bool _isMonitoring = false;
        private string _currentMode = "both";
        private CancellationTokenSource? _cancellationTokenSource;
        private Mat? _currentFrame;
        private Mat? _previousFrame;
        private bool _motionDetected = false;
        private bool _personDetected = false;
        private double _confidence = 0.0;
        private double _motionPercentage = 0.0;
        private readonly object _frameLock = new();

        private readonly FaceRecognitionService _faceService;
        private readonly EmailNotificationService _emailService;
        private readonly CloudStorageService _cloudService;
        private string _currentUserEmail = string.Empty;

        // Control flag to suppress alerts (e.g. during enrollment)
        public bool SuppressAlerts { get; set; } = false;

        // Detection performance tuning
        private int _detectionFrameInterval = 4;
        private int _frameCounter = 0;
        private List<DetectedFace> _lastFaceDetections = new();
        private SocketIOClient.SocketIO? _socketClient;

        // Motion detection settings - KEEPING THESE
        private const int MotionThreshold = 25;
        private const int MinMotionArea = 500;
        private const int BlurSize = 21;
        private const int MotionAlertCooldownSeconds = 2;
        private DateTime _lastMotionAlert = DateTime.MinValue;

        // Person alert settings
        private const int PersonAlertCooldownSeconds = 30; // Don't spam emails
        private DateTime _lastPersonAlert = DateTime.MinValue;

        public event Action<DetectionEvent>? OnDetectionEvent;

        public class DetectionEvent
        {
            public DateTime Timestamp { get; set; }
            public string EventType { get; set; } // "Motion", "Person"
            public string Message { get; set; }
            public double Value { get; set; }
        }

        public LocalVisionService(
            FaceRecognitionService faceService, 
            EmailNotificationService emailService,
            CloudStorageService cloudService)
        {
            _faceService = faceService;
            _emailService = emailService;
            _cloudService = cloudService;
            
            // Initialize models
            _faceService.Initialize();
            
             Console.WriteLine("✓ LocalVisionService initialized with Face Detection");
             
             InitializeSocket();
        }

        private async void InitializeSocket()
        {
            try 
            {
                // switch to production server
                _socketClient = new SocketIOClient.SocketIO("https://observa-ocaa.onrender.com");
                await _socketClient.ConnectAsync();
                Console.WriteLine("✓ Connected to Live Stream Server");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Socket connection failed: {ex.Message}");
            }
        }

        public async Task<VisionStartResponse> StartMonitoringAsync(string mode, string userId)
        {
            return await Task.Run(() =>
            {
                try
                {
                    if (_isMonitoring)
                    {
                        return new VisionStartResponse
                        {
                            Success = false,
                            Message = "Monitoring already running"
                        };
                    }

                    _currentMode = mode;
                    _currentUserEmail = userId;  // Store user email for face filtering
                    
                    Console.WriteLine($"[START] Monitoring started - Mode: {mode}, User: {userId}");
                    Console.WriteLine($"[START] Face service initialized: {_faceService != null}");
                    
                    _isMonitoring = true;
                    _cancellationTokenSource = new CancellationTokenSource();

                    // Initialize camera capture (2 = DroidCam phone camera)
                    _videoCapture = new VideoCapture(2);

                    if (!_videoCapture.IsOpened)
                    {
                        _isMonitoring = false;
                        return new VisionStartResponse
                        {
                            Success = false,
                            Message = "Failed to open camera"
                        };
                    }

                    // Set camera properties
                    _videoCapture.Set(CapProp.FrameWidth, 640);
                    _videoCapture.Set(CapProp.FrameHeight, 480);
                    _videoCapture.Set(CapProp.Fps, 30);

                    // Start monitoring task
                    _ = MonitoringLoopAsync(_cancellationTokenSource.Token);

                    return new VisionStartResponse
                    {
                        Success = true,
                        Mode = mode,
                        Message = "Monitoring started"
                    };
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Start monitoring error: {ex.Message}");
                    _isMonitoring = false;
                    return new VisionStartResponse
                    {
                        Success = false,
                        Message = ex.Message
                    };
                }
            });
        }

        public async Task<VisionStopResponse> StopMonitoringAsync()
        {
            return await Task.Run(() =>
            {
                try
                {
                    if (!_isMonitoring)
                    {
                        return new VisionStopResponse
                        {
                            Success = false,
                            Message = "Monitoring not running"
                        };
                    }

                    _isMonitoring = false;
                    _cancellationTokenSource?.Cancel();

                    // Wait a bit for the monitoring loop to stop
                    Thread.Sleep(500);

                    _videoCapture?.Dispose();
                    _videoCapture = null;
                    _previousFrame?.Dispose();
                    _previousFrame = null;

                    return new VisionStopResponse
                    {
                        Success = true,
                        Message = "Monitoring stopped"
                    };
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Stop monitoring error: {ex.Message}");
                    return new VisionStopResponse
                    {
                        Success = false,
                        Message = ex.Message
                    };
                }
            });
        }

        public async Task<VisionStatusResponse> GetStatusAsync()
        {
            return await Task.Run(() =>
            {
                return new VisionStatusResponse
                {
                    Success = true,
                    IsRunning = _isMonitoring,
                    Mode = _currentMode,
                    Message = _isMonitoring ? "Monitoring active" : "Monitoring inactive"
                };
            });
        }

        public Mat? GetLatestFrame()
        {
            lock (_frameLock)
            {
                if (_currentFrame == null || _currentFrame.IsEmpty)
                    return null;
                
                return _currentFrame.Clone();
            }
        }

        public async Task<VisionFrameResponse?> GetCurrentFrameAsync()
        {
            return await Task.Run(() =>
            {
                try
                {
                    lock (_frameLock)
                    {
                        if (_currentFrame == null || _currentFrame.IsEmpty)
                        {
                            return null;
                        }

                        // Convert frame to base64 for transmission
                        string frameBase64 = MatToBase64(_currentFrame);

                        return new VisionFrameResponse
                        {
                            Success = true,
                            Frame = frameBase64,
                            MotionDetected = _motionDetected,
                            PersonDetected = _personDetected,
                            Confidence = _confidence,
                            Message = "Frame captured successfully"
                        };
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Get frame error: {ex.Message}");
                    return null;
                }
            });
        }

        private async Task MonitoringLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested && _isMonitoring)
                {
                    if (_videoCapture == null || !_videoCapture.IsOpened)
                        break;

                    Mat frame = new Mat();
                    if (!_videoCapture.Read(frame))
                    {
                        await Task.Delay(33, cancellationToken);
                        continue;
                    }

                    if (frame.IsEmpty)
                    {
                        frame.Dispose();
                        await Task.Delay(33, cancellationToken);
                        continue;
                    }

                    Mat annotatedFrame = frame.Clone();

                    // Detect motion if enabled
                    bool motionAlert = false;
                    if (_currentMode == "motion" || _currentMode == "both")
                    {
                        (motionAlert, annotatedFrame) = DetectMotion(frame, annotatedFrame);
                    }

                    // Detect faces if enabled (run detection only every N frames to improve FPS)
                    bool faceAlert = false;
                    double confidence = 0.0;
                    
                    if (_currentMode == "person" || _currentMode == "both") // "person" mode now means "face" detection
                    {
                        _frameCounter++;
                        if (_frameCounter % _detectionFrameInterval == 0)
                        {
                            // Run actual face detection and recognition
                            (faceAlert, confidence, annotatedFrame) = await ProcessFacesAsync(frame, annotatedFrame);
                        }
                        else
                        {
                            // Draw last detected faces on skipped frames to maintain UI smoothness
                            if (_lastFaceDetections != null && _lastFaceDetections.Count > 0)
                            {
                                foreach (var face in _lastFaceDetections)
                                {
                                    var rect = face.Location.ToRectangle();
                                    var color = face.MatchedName != null ? new MCvScalar(0, 255, 0) : new MCvScalar(0, 0, 255);
                                    var label = face.MatchedName ?? "UNKNOWN";
                                    
                                    CvInvoke.Rectangle(annotatedFrame, rect, color, 2);
                                    CvInvoke.PutText(annotatedFrame, label, new Point(rect.X, Math.Max(0, rect.Y - 5)), 
                                        FontFace.HersheyPlain, 0.8, color, 2);
                                }
                            }
                        }
                    }

                    lock (_frameLock)
                    {
                        // Always draw system status overlay
                        string statusText = $"Mode: {_currentMode} | User: {_currentUserEmail}";
                        CvInvoke.PutText(annotatedFrame, statusText, new Point(10, 30), 
                            FontFace.HersheyPlain, 1.2, new MCvScalar(0, 255, 255), 2); // Yellow text
                            
                        // Draw model initialization status if using face detection
                        if (_currentMode == "person" || _currentMode == "both")
                        {
                            bool modelsLoaded = _faceService.IsInitialized;
                            string statusMsg = modelsLoaded ? "Face Models: OK" : $"ERROR: {_faceService.InitializationError ?? "Check Console"}";
                            var color = modelsLoaded ? new MCvScalar(0, 255, 0) : new MCvScalar(0, 0, 255);
                            
                            // Draw status background for readability if error
                            if (!modelsLoaded)
                            {
                                CvInvoke.Rectangle(annotatedFrame, new Rectangle(5, 45, 600, 30), new MCvScalar(0, 0, 0), -1);
                            }

                            CvInvoke.PutText(annotatedFrame, statusMsg, new Point(10, 65), 
                                FontFace.HersheyPlain, 1.0, color, 2);
                        }

                        _currentFrame?.Dispose();
                        _currentFrame = annotatedFrame;
                        _motionDetected = motionAlert;
                        _personDetected = faceAlert; // Reuse this flag for face detection
                        _confidence = confidence;
                    }

                    frame.Dispose();

                    // Broadcast Frame to Socket (Fire and forget, don't await)
                    if (_socketClient != null && _socketClient.Connected)
                    {
                        // Use the annotated frame or raw frame? Annotated has overlays, which is good for dashboard.
                        // But we need to convert to Base64 first.
                        string frameBase64 = MatToBase64(annotatedFrame);
                        if (!string.IsNullOrEmpty(frameBase64)) 
                        {
                            // 4b. Broadcast Securely (Include User Email)
                            await _socketClient.EmitAsync("broadcast-frame", new 
                            { 
                                userEmail = _currentUserEmail, 
                                image = frameBase64 
                            });
                        }
                    }

                    // Process at ~30 FPS
                    await Task.Delay(33, cancellationToken);
                }
            }
            catch (OperationCanceledException)
            {
                // Expected when monitoring is stopped
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Monitoring loop error: {ex.Message}");
            }
        }

        private (bool alertMotion, Mat annotatedFrame) DetectMotion(Mat currentFrame, Mat annotatedFrame)
        {
            try
            {
                // Convert to grayscale for motion detection
                Mat currentGray = new Mat();
                CvInvoke.CvtColor(currentFrame, currentGray, ColorConversion.Bgr2Gray);
                CvInvoke.GaussianBlur(currentGray, currentGray, new Size(BlurSize, BlurSize), 0);

                bool motionRaw = false;
                double motionPercentage = 0.0;

                if (_previousFrame != null && !_previousFrame.IsEmpty)
                {
                    // Frame differencing
                    Mat diffFrame = new Mat();
                    CvInvoke.AbsDiff(currentGray, _previousFrame, diffFrame);

                    // Apply threshold
                    Mat thresholdFrame = new Mat();
                    CvInvoke.Threshold(diffFrame, thresholdFrame, MotionThreshold, 255, ThresholdType.Binary);
                    CvInvoke.Dilate(thresholdFrame, thresholdFrame, null, new Point(-1, -1), 2, BorderType.Reflect, new MCvScalar());

                    // Count non-zero pixels for motion detection
                    int motionPixels = CvInvoke.CountNonZero(thresholdFrame);
                    motionRaw = motionPixels > MinMotionArea;

                    // Calculate motion percentage
                    int frameArea = currentFrame.Height * currentFrame.Width;
                    motionPercentage = frameArea > 0 ? ((double)motionPixels / frameArea) * 100 : 0.0;

                    // Draw motion visualization
                    if (motionRaw)
                    {
                        CvInvoke.CvtColor(thresholdFrame, thresholdFrame, ColorConversion.Gray2Bgr);
                        // Blend the motion mask onto the annotated frame for visualization
                        CvInvoke.AddWeighted(annotatedFrame, 0.7, thresholdFrame, 0.3, 0, annotatedFrame);
                    }

                    // Cleanup
                    diffFrame.Dispose();
                    thresholdFrame.Dispose();
                }

                // Draw status text
                string statusText = motionRaw ? "MOTION DETECTED" : "No Motion";
                MCvScalar statusColor = motionRaw ? new MCvScalar(0, 0, 255) : new MCvScalar(0, 255, 0);

                CvInvoke.PutText(annotatedFrame, statusText, new Point(10, 30),
                    FontFace.HersheyPlain, 0.8, statusColor, 2);

                CvInvoke.PutText(annotatedFrame, $"Motion: {motionPercentage:F1}%", new Point(10, 55),
                    FontFace.HersheyPlain, 0.6, new MCvScalar(255, 255, 255), 1);

                _previousFrame?.Dispose();
                _previousFrame = currentGray;

                // Alert logic with cooldown
                bool alertMotion = false;
                if (motionRaw)
                {
                    TimeSpan timeSinceLastAlert = DateTime.Now - _lastMotionAlert;
                    if (timeSinceLastAlert.TotalSeconds > MotionAlertCooldownSeconds)
                    {
                        _lastMotionAlert = DateTime.Now;
                        alertMotion = true;
                        
                        // Play beep sound
                        PlayBeep();
                        
                        // Fire detection event
                        OnDetectionEvent?.Invoke(new DetectionEvent
                        {
                            Timestamp = DateTime.Now,
                            EventType = "Motion",
                            Message = $"Motion detected - {motionPercentage:F1}%",
                            Value = motionPercentage
                        });

                        // Take snapshot ONLY on first motion alert (when cooldown expires)
                        // Don't take it on every motion frame
                        SaveSnapshot(currentFrame);
                    }
                }

                _motionPercentage = motionPercentage;
                return (alertMotion, annotatedFrame);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Motion detection error: {ex.Message}");
                return (false, annotatedFrame);
            }
        }

        private async Task<(bool alert, double confidence, Mat annotatedFrame)> ProcessFacesAsync(Mat frame, Mat annotatedFrame)
        {
            try
            {
                // Just DETECT faces, no encoding needed for "Person Detection"
                // DetectAndEncodeFaces now acts as a wrapper for DetectFaces with dummy "Person" name
                var detectedFaces = _faceService.DetectAndEncodeFaces(frame);
                _lastFaceDetections = detectedFaces;

                bool personDetected = false;

                foreach (var face in detectedFaces)
                {
                    personDetected = true;
                    var rect = face.Location.ToRectangle();
                    
                    // Simple green box for any person
                    CvInvoke.Rectangle(annotatedFrame, rect, new MCvScalar(0, 255, 0), 2);
                    CvInvoke.PutText(annotatedFrame, "PERSON", 
                        new Point(rect.X, Math.Max(0, rect.Y - 5)),
                        FontFace.HersheyPlain, 0.8, new MCvScalar(0, 255, 0), 2);

                    // If NOT suppressing alerts, we could fire an event
                    if (!SuppressAlerts)
                    {
                         OnDetectionEvent?.Invoke(new DetectionEvent
                        {
                            Timestamp = DateTime.Now,
                            EventType = "Person",
                            Message = "Person detected",
                            Value = 1.0
                        });

                        // Send email alert with cooldown
                        TimeSpan timeSinceLastAlert = DateTime.Now - _lastPersonAlert;
                        if (timeSinceLastAlert.TotalSeconds > PersonAlertCooldownSeconds)
                        {
                            _lastPersonAlert = DateTime.Now;
                            _lastPersonAlert = DateTime.Now;
                            Console.WriteLine($"[ALERT] Process started for unknown face...");

                            // Convert images to frame bytes (for upload)
                            byte[] frameBytes = null;
                            try {
                                frameBytes = frame.ToImage<Bgr, byte>().ToJpegData(80);
                            } catch {}

                            // Fire and forget upload task
                            _ = Task.Run(async () => {
                                if (frameBytes != null)
                                {
                                    string? imagePath = await _cloudService.UploadEventImageAsync(frameBytes, _currentUserEmail);
                                    if (imagePath != null)
                                    {
                                        await _cloudService.LogEventAsync(_currentUserEmail, imagePath, 0.9);
                                    }
                                }
                            });
                        }
                    }
                }

                if (detectedFaces.Count > 0)
                {
                    // Update confidence (mock value for basic detection)
                    return (true, 0.9, annotatedFrame); 
                }

                return (false, 0.0, annotatedFrame);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Face processing error: {ex.Message}");
                Console.WriteLine($"Stack: {ex.StackTrace}");
                return (false, 0.0, annotatedFrame);
            }
        }

        
        
        private string MatToBase64(Mat mat)
        {
            try
            {
                if (mat == null || mat.IsEmpty)
                    return string.Empty;

                // Create a copy for encoding to avoid issues with threading
                Mat matCopy = mat.Clone();
                
                // Convert to byte array using OpenCV imencode
                var buf = new Emgu.CV.Util.VectorOfByte();
                CvInvoke.Imencode(".jpg", matCopy, buf);
                byte[] imageBytes = buf.ToArray();
                matCopy.Dispose();
                buf.Dispose();

                return Convert.ToBase64String(imageBytes);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Frame encoding error: {ex.Message}");
                return string.Empty;
            }
        }

        private void PlayBeep()
        {
            try
            {
                // Play system beep (simple beep)
                Console.Beep(1000, 200); // 1000Hz for 200ms
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Beep error: {ex.Message}");
            }
        }

        private void SaveSnapshot(Mat frame)
        {
            try
            {
                // Get project root directory (go up 4 levels from bin\Debug\net9.0-windows)
                string projectRoot = AppDomain.CurrentDomain.BaseDirectory;
                
                // Navigate up to project root
                DirectoryInfo dirInfo = new DirectoryInfo(projectRoot);
                while (dirInfo.Parent != null && dirInfo.Name != "MonitorMySpace")
                {
                    dirInfo = dirInfo.Parent;
                }
                projectRoot = dirInfo.FullName;

                // Create Snapshots folder in project root
                string snapshotsDir = Path.Combine(projectRoot, "Snapshots");

                Console.WriteLine($"📂 Snapshots directory: {snapshotsDir}");

                // Ensure directory exists
                if (!Directory.Exists(snapshotsDir))
                {
                    Directory.CreateDirectory(snapshotsDir);
                    Console.WriteLine($"✓ Created Snapshots folder in project root");
                }

                // Create filename with timestamp
                string timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
                string filename = Path.Combine(snapshotsDir, $"snapshot_{timestamp}.jpg");

                // Save the frame using Emgu.CV Imwrite
                bool success = CvInvoke.Imwrite(filename, frame);
                
                if (success)
                {
                    Console.WriteLine($"✓ Snapshot saved to: {filename}");
                }
                else
                {
                    Console.WriteLine($"✗ Failed to write snapshot: {filename}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"✗ Snapshot save error: {ex.Message}");
            }
        }

        public void Dispose()
        {
            _isMonitoring = false;
            _cancellationTokenSource?.Cancel();
            _cancellationTokenSource?.Dispose();
            _videoCapture?.Dispose();
            _currentFrame?.Dispose();
            _previousFrame?.Dispose();
            
            // Dispose recognition services
            _faceService?.Dispose();
        }
    }
}
