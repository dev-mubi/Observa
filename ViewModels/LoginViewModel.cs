using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.DependencyInjection;
using SentinelIntrusionDetection.Services;
using SentinelIntrusionDetection.Views;
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows;

namespace SentinelIntrusionDetection.ViewModels
{
    public partial class LoginViewModel : ObservableObject
    {
        private readonly IAuthService _authService;

        [ObservableProperty]
        private string _statusMessage = "Ready to authenticate";

        [ObservableProperty]
        private bool _isLoading = false;

        [ObservableProperty]
        private bool _isAuthenticating = false;

        public LoginViewModel(IAuthService authService)
        {
            _authService = authService ?? throw new ArgumentNullException(nameof(authService));
        }

        [RelayCommand]
        private async Task LoginAsync()
        {
            try
            {
                IsLoading = true;
                IsAuthenticating = true;
                StatusMessage = "Initializing authentication...";

                // Step 1: Initiate login
                var loginResponse = await _authService.InitiateLoginAsync();

                if (loginResponse == null || !loginResponse.Success)
                {
                    StatusMessage = $"Error: {loginResponse?.Message ?? "Unknown error"}";
                    IsLoading = false;
                    IsAuthenticating = false;
                    return;
                }

                StatusMessage = "Opening browser for authentication...";

                // Step 2: Open browser with auth URL
                try
                {
                    if (string.IsNullOrEmpty(loginResponse.AuthUrl))
                    {
                        StatusMessage = "Error: Invalid authentication URL";
                        IsLoading = false;
                        IsAuthenticating = false;
                        return;
                    }

                    Process.Start(new ProcessStartInfo
                    {
                        FileName = loginResponse.AuthUrl,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    StatusMessage = $"Failed to open browser: {ex.Message}";
                    IsLoading = false;
                    IsAuthenticating = false;
                    return;
                }

                StatusMessage = "Waiting for authentication... Please complete login in browser.";

                // Step 3: Poll for token
                var sessionId = loginResponse.SessionId;

                if (string.IsNullOrEmpty(sessionId))
                {
                    StatusMessage = "Error: Invalid session ID";
                    IsLoading = false;
                    IsAuthenticating = false;
                    return;
                }

                var maxAttempts = 60; // 60 attempts = 2 minutes
                var attempt = 0;

                while (attempt < maxAttempts)
                {
                    await Task.Delay(2000); // Poll every 2 seconds
                    attempt++;

                    var statusResponse = await _authService.CheckTokenStatusAsync(sessionId);

                    if (statusResponse == null)
                    {
                        StatusMessage = "Error: Failed to check authentication status";
                        IsLoading = false;
                        IsAuthenticating = false;
                        return;
                    }

                    if (statusResponse.Status == "success" &&
                        statusResponse.AccessToken != null &&
                        statusResponse.User != null)
                    {
                        // Authentication successful!
                        _authService.SaveToken(statusResponse.AccessToken, statusResponse.User);
                        StatusMessage = $"Welcome, {statusResponse.User.Name}!";

                        await Task.Delay(1000);

                        // Navigate to main window
                        Application.Current.Dispatcher.Invoke(() =>
                        {
                            var mainWindow = App.ServiceProvider?.GetService(typeof(MainWindow)) as MainWindow;
                            if (mainWindow != null)
                            {
                                mainWindow.Show();
                                Application.Current.MainWindow = mainWindow;

                                // Close login window
                                foreach (Window window in Application.Current.Windows)
                                {
                                    if (window is LoginWindow)
                                    {
                                        window.Close();
                                        break;
                                    }
                                }
                            }
                            else
                            {
                                MessageBox.Show("Failed to create main window. Check DI configuration.",
                                    "Error", MessageBoxButton.OK, MessageBoxImage.Error);
                            }
                        });

                        IsLoading = false;
                        IsAuthenticating = false;
                        return;
                    }
                    else if (statusResponse.Status == "error")
                    {
                        StatusMessage = $"Authentication failed: {statusResponse.Message ?? "Unknown error"}";
                        IsLoading = false;
                        IsAuthenticating = false;
                        return;
                    }
                    else if (statusResponse.Status == "expired")
                    {
                        StatusMessage = "Authentication session expired. Please try again.";
                        IsLoading = false;
                        IsAuthenticating = false;
                        return;
                    }

                    // Still pending, continue polling
                    StatusMessage = $"Waiting for authentication... ({attempt}/{maxAttempts})";
                }

                // Timeout
                StatusMessage = "Authentication timeout. Please try again.";
                IsLoading = false;
                IsAuthenticating = false;
            }
            catch (Exception ex)
            {
                StatusMessage = $"Error: {ex.Message}";
                IsLoading = false;
                IsAuthenticating = false;
            }
        }
    }
}