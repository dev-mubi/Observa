# YOLOv8 Model Download Instructions

## Automatic Download (at runtime)

The application will attempt to download the YOLOv8 nano model automatically when it first runs.
The model will be saved to: `Models/yolov8n.onnx`

## Face Recognition Models (Dlib)
The Application also requires Dlib models for face recognition. These are too large for GitHub and must be downloaded manually or via the script if available.

**Required Files:**
1. `shape_predictor_68_face_landmarks.dat` (Extract from http://dlib.net/files/shape_predictor_68_face_landmarks.dat.bz2)
2. `dlib_face_recognition_resnet_model_v1.dat` (Extract from http://dlib.net/files/dlib_face_recognition_resnet_model_v1.dat.bz2)

Place them in the `Models/FaceRecognition/` folder.

## Manual Download (if automatic fails)

### Option 1: Direct Download

1. Download from official Ultralytics AWS S3:

   ```
   https://ultralytics-assets.s3.amazonaws.com/yolov8/v8.2.0/yolov8n.onnx
   ```

2. Save the file as:
   ```
   F:\SEM 5 ACADAMIA\Advanced Programming\MonitorMySpace\Models\yolov8n.onnx
   ```

### Option 2: Using Python (if installed)

```bash
cd "f:\SEM 5 ACADAMIA\Advanced Programming\MonitorMySpace\Models"
python -c "import urllib.request; urllib.request.urlretrieve('https://ultralytics-assets.s3.amazonaws.com/yolov8/v8.2.0/yolov8n.onnx', 'yolov8n.onnx')"
```

### Option 3: Using PowerShell (with working internet)

```powershell
cd "f:\SEM 5 ACADAMIA\Advanced Programming\MonitorMySpace\Models"
Invoke-WebRequest -Uri "https://ultralytics-assets.s3.amazonaws.com/yolov8/v8.2.0/yolov8n.onnx" -OutFile "yolov8n.onnx"
```

### Option 4: GitHub Releases

1. Go to: https://github.com/ultralytics/assets/releases/tag/v8.2.0
2. Download: yolov8n.onnx
3. Place in: `Models/yolov8n.onnx`

## Verify Download

Once downloaded, the file should be approximately 12-13 MB.
The application will look for it at startup and initialize the YOLO detector.

## If Download Fails

The application has a fallback mode that uses Haar Cascade classifiers for basic person detection.
This is slower but will allow the application to run without the YOLO model.
