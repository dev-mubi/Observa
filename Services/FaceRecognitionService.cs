using Emgu.CV;
using Emgu.CV.Structure;
using FaceRecognitionDotNet;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;

namespace SentinelIntrusionDetection.Services
{
    /// <summary>
    /// Face recognition service using FaceRecognitionDotNet (dlib-based)
    /// Provides face detection and 128-dimensional encoding generation
    /// </summary>
    public class FaceRecognitionService : IDisposable
    {
        private FaceRecognition? _faceRecognition;
        private readonly string _modelPath;
        public bool IsInitialized => _isInitialized;
        private bool _isInitialized = false;
        public string? InitializationError { get; private set; }
        private const double DefaultMatchThreshold = 0.40;

        public FaceRecognitionService()
        {
            // Get model path from project directory
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var dirInfo = new DirectoryInfo(baseDir);
            
            while (dirInfo.Parent != null && dirInfo.Name != "MonitorMySpace")
            {
                dirInfo = dirInfo.Parent;
            }

            _modelPath = Path.Combine(dirInfo.FullName, "Models", "FaceRecognition");
            Console.WriteLine($"✓ Face recognition path: {_modelPath}");
        }

        /// <summary>
        /// Initialize the face recognition models
        /// Must be called before using any detection/recognition methods
        /// </summary>
        /// <returns>True if initialization successful</returns>
        public bool Initialize()
        {
            try
            {
                // Verify model files exist
                var landmark5 = Path.Combine(_modelPath, "shape_predictor_5_face_landmarks.dat");
                var landmark68 = Path.Combine(_modelPath, "shape_predictor_68_face_landmarks.dat");
                var recognitionPath = Path.Combine(_modelPath, "dlib_face_recognition_resnet_model_v1.dat");
                var mmodPath = Path.Combine(_modelPath, "mmod_human_face_detector.dat");

                bool hasLandmarks = File.Exists(landmark5) || File.Exists(landmark68);
                bool hasRecognition = File.Exists(recognitionPath);
                bool hasMmod = File.Exists(mmodPath);

                if (!hasLandmarks)
                {
                    InitializationError = "Missing: shape_predictor_68_face_landmarks.dat";
                    Console.WriteLine($"❌ {InitializationError}");
                    return false;
                }

                if (!hasRecognition)
                {
                    InitializationError = "Missing: dlib_face_recognition_resnet_model_v1.dat";
                    Console.WriteLine($"❌ {InitializationError}");
                    return false;
                }

                if (!hasMmod)
                {
                    InitializationError = "Missing: mmod_human_face_detector.dat";
                    Console.WriteLine($"❌ {InitializationError}");
                    return false;
                }

                Console.WriteLine("✓ Model files found");
                
                // Initialize FaceRecognition with model directory
                _faceRecognition = FaceRecognition.Create(_modelPath);
                _isInitialized = true;
                InitializationError = null;

                Console.WriteLine("✅ Face recognition initialized successfully");
                return true;
            }
            catch (Exception ex)
            {
                InitializationError = $"Ex: {ex.Message}";
                // Check inner exception for Dlib specifics
                if (ex.InnerException != null)
                    InitializationError += $" ({ex.InnerException.Message})";

                Console.WriteLine($"❌ Failed to initialize face recognition: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Detect faces in a frame
        /// </summary>
        /// <param name="frame">Emgu.CV Mat frame from camera</param>
        /// <returns>List of face locations</returns>
        public List<FaceLocationInfo> DetectFaces(Mat frame)
        {
            if (!_isInitialized || _faceRecognition == null)
            {
                throw new InvalidOperationException("Face recognition not initialized. Call Initialize() first.");
            }

            try
            {
                // Convert Emgu.CV Mat to System.Drawing.Bitmap using vectorOfByte
                var vectorOfByte = new Emgu.CV.Util.VectorOfByte();
                CvInvoke.Imencode(".jpg", frame, vectorOfByte);
                byte[] imageBytes = vectorOfByte.ToArray();
                vectorOfByte.Dispose();
                
                using var ms = new System.IO.MemoryStream(imageBytes);
                using var bitmap = new Bitmap(ms);
                
                // Convert Bitmap to FaceRecognitionDotNet Image
                using var image = FaceRecognition.LoadImage(bitmap);

                // Detect face locations
                var locations = _faceRecognition.FaceLocations(image).ToList();

                var result = new List<FaceLocationInfo>();
                foreach (var location in locations)
                {
                    result.Add(new FaceLocationInfo
                    {
                        Top = location.Top,
                        Right = location.Right,
                        Bottom = location.Bottom,
                        Left = location.Left
                    });
                }

                if (result.Count > 0)
                {
                    Console.WriteLine($"✓ Detected {result.Count} face(s)");
                }

                return result;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Face detection error: {ex.Message}");
                return new List<FaceLocationInfo>();
            }
        }

        /// <summary>
        /// Detect faces and generate encodings in one call -> NOW JUST DETECTS FACES
        /// Kept for compatibility but should be replaced by DetectFaces
        /// </summary>
        public List<DetectedFace> DetectAndEncodeFaces(Mat frame)
        {
            var faces = DetectFaces(frame);
            return faces.Select(f => new DetectedFace 
            { 
                Location = f,
                MatchedName = "Person"
            }).ToList();
        }

        public void Dispose()
        {
            _faceRecognition?.Dispose();
            _isInitialized = false;
            Console.WriteLine("✓ Face recognition service disposed");
        }
    }

    /// <summary>
    /// Face location information
    /// </summary>
    public class FaceLocationInfo
    {
        public int Top { get; set; }
        public int Right { get; set; }
        public int Bottom { get; set; }
        public int Left { get; set; }

        public int Width => Right - Left;
        public int Height => Bottom - Top;

        public Rectangle ToRectangle()
        {
            return new Rectangle(Left, Top, Width, Height);
        }

        public override string ToString()
        {
            return $"Face at ({Left},{Top}) size {Width}x{Height}";
        }
    }

    /// <summary>
    /// Detected face with location
    /// </summary>
    public class DetectedFace
    {
        public FaceLocationInfo Location { get; set; } = new FaceLocationInfo();
        public string? MatchedName { get; set; }
        public double? MatchConfidence { get; set; }
    }
}
