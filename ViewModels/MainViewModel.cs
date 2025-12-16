using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using SentinelIntrusionDetection.Services;
using System;
using System.Collections.ObjectModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media.Imaging;

namespace SentinelIntrusionDetection.ViewModels
{
    public partial class MainViewModel : ObservableObject
    {
        private readonly IVisionService _visionService;
        private readonly IAuthService _authService;
        private CancellationTokenSource? _cancellationTokenSource;
        private Timer? _frameUpdateTimer;

        [ObservableProperty]
        private BitmapImage? _currentFrame;

        [ObservableProperty]
        private string _statusMessage = "Ready to start monitoring";

        [ObservableProperty]
        private bool _isMonitoring = false;

        [ObservableProperty]
        private string _userName = "User";

        [ObservableProperty]
        private string _userEmail = string.Empty;

        [ObservableProperty]
        private bool _motionDetectionEnabled = true;

        [ObservableProperty]
        private bool _personDetectionEnabled = true;

        [ObservableProperty]
        private int _detectionCount = 0;

        [ObservableProperty]
        private string _lastDetectionTime = "Never";

        [ObservableProperty]
        private ObservableCollection<DetectionLogEntry> _detectionLogs = new();

        [ObservableProperty]
        private int _motionCount = 0;

        [ObservableProperty]
        private int _personCount = 0;

        public class DetectionLogEntry
        {
            public DateTime Timestamp { get; set; }
            public string Type { get; set; } // "Motion" or "Person"
            public string Message { get; set; }
            public string TimeDisplay => Timestamp.ToString("HH:mm:ss");
        }

        public MainViewModel(IVisionService visionService, IAuthService authService)
        {
            _visionService = visionService;
            _authService = authService;

            var user = _authService.GetCurrentUser();
            if (user != null)
            {
                UserName = user.Name ?? "User";
                UserEmail = user.Email ?? string.Empty;
            }
        }

        [RelayCommand]
        private async Task StartMonitoringAsync()
        {
            try
            {
                StatusMessage = "Starting monitoring...";
                IsMonitoring = true;

                string mode = "both";
                if (MotionDetectionEnabled && PersonDetectionEnabled)
                    mode = "both";
                else if (MotionDetectionEnabled)
                    mode = "motion";
                else if (PersonDetectionEnabled)
                    mode = "person";

                var result = await _visionService.StartMonitoringAsync(mode, UserEmail);

                if (result != null && result.Success)
                {
                    StatusMessage = "Monitoring active";
                    DetectionLogs.Clear();
                    MotionCount = 0;
                    PersonCount = 0;
                    _cancellationTokenSource = new CancellationTokenSource();

                    // Subscribe to detection events
                    if (_visionService is LocalVisionService localVisionService)
                    {
                        localVisionService.OnDetectionEvent += OnDetectionOccurred;
                    }

                    _frameUpdateTimer = new Timer(async _ => await UpdateFrameAsync(),
                        null,
                        TimeSpan.Zero,
                        TimeSpan.FromMilliseconds(100));
                }
                else
                {
                    StatusMessage = "Failed to start monitoring";
                    IsMonitoring = false;
                }
            }
            catch (Exception ex)
            {
                StatusMessage = $"Error: {ex.Message}";
                IsMonitoring = false;
            }
        }

        [RelayCommand]
        private async Task StopMonitoringAsync()
        {
            try
            {
                StatusMessage = "Stopping monitoring...";

                // Unsubscribe from detection events
                if (_visionService is LocalVisionService localVisionService)
                {
                    localVisionService.OnDetectionEvent -= OnDetectionOccurred;
                }

                _frameUpdateTimer?.Dispose();
                _frameUpdateTimer = null;

                _cancellationTokenSource?.Cancel();

                await _visionService.StopMonitoringAsync();

                IsMonitoring = false;
                StatusMessage = "Monitoring stopped";
                CurrentFrame = null;
            }
            catch (Exception ex)
            {
                StatusMessage = $"Error stopping: {ex.Message}";
            }
        }

        private async Task UpdateFrameAsync()
        {
            try
            {
                var frameData = await _visionService.GetCurrentFrameAsync();

                if (frameData != null && !string.IsNullOrEmpty(frameData.Frame))
                {
                    if (frameData.MotionDetected || frameData.PersonDetected)
                    {
                        DetectionCount++;
                        LastDetectionTime = DateTime.Now.ToString("HH:mm:ss");

                        string alertMessage = "";
                        if (frameData.MotionDetected)
                            alertMessage += "Motion detected! ";
                        if (frameData.PersonDetected)
                            alertMessage += $"Person detected! (Confidence: {frameData.Confidence:F2})";

                        StatusMessage = alertMessage;
                    }

                    Application.Current.Dispatcher.Invoke(() =>
                    {
                        try
                        {
                            byte[] imageBytes = Convert.FromBase64String(frameData.Frame);
                            var bitmap = new BitmapImage();
                            using (var stream = new System.IO.MemoryStream(imageBytes))
                            {
                                bitmap.BeginInit();
                                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                                bitmap.StreamSource = stream;
                                bitmap.EndInit();
                                bitmap.Freeze();
                            }
                            CurrentFrame = bitmap;
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"Frame decode error: {ex.Message}");
                        }
                    });
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Frame update error: {ex.Message}");
            }
        }

        private void OnDetectionOccurred(LocalVisionService.DetectionEvent detectionEvent)
        {
            try
            {
                Application.Current.Dispatcher.Invoke(() =>
                {
                    // Add to logs
                    var logEntry = new DetectionLogEntry
                    {
                        Timestamp = detectionEvent.Timestamp,
                        Type = detectionEvent.EventType,
                        Message = detectionEvent.Message
                    };
                    DetectionLogs.Insert(0, logEntry); // Add to top

                    // Keep only last 100 logs
                    while (DetectionLogs.Count > 100)
                    {
                        DetectionLogs.RemoveAt(DetectionLogs.Count - 1);
                    }

                    // Update counters
                    if (detectionEvent.EventType == "Motion")
                    {
                        MotionCount++;
                    }
                    else if (detectionEvent.EventType == "Person")
                    {
                        PersonCount++;
                    }

                    // Update overall detection count
                    DetectionCount++;
                    LastDetectionTime = DateTime.Now.ToString("HH:mm:ss");

                    // Update status message
                    StatusMessage = $"🚨 {detectionEvent.Message}";
                });
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Detection event error: {ex.Message}");
            }
        }

        [RelayCommand]
        private async Task LogoutAsync()
        {
            await StopMonitoringAsync();
            _authService.ClearToken();

            Application.Current.Dispatcher.Invoke(() =>
            {
                var loginWindow = App.ServiceProvider?.GetService(typeof(Views.LoginWindow)) as Views.LoginWindow;
                if (loginWindow != null)
                {
                    loginWindow.Show();
                    Application.Current.MainWindow?.Close();
                }
            });
        }
    }
}