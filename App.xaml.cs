using Microsoft.Extensions.DependencyInjection;
using SentinelIntrusionDetection.Services;
using SentinelIntrusionDetection.ViewModels;
using SentinelIntrusionDetection.Views;
using System;
using System.Windows;

namespace SentinelIntrusionDetection
{
    public partial class App : Application
    {
        public static IServiceProvider? ServiceProvider { get; private set; }

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            // Configure dependency injection
            var serviceCollection = new ServiceCollection();
            ConfigureServices(serviceCollection);
            ServiceProvider = serviceCollection.BuildServiceProvider();

            // Show login window
            var loginWindow = ServiceProvider.GetRequiredService<LoginWindow>();
            loginWindow.Show();
        }

        private void ConfigureServices(IServiceCollection services)
        {
            // Register HttpClient factory
            services.AddHttpClient();

            // Register AuthService as Singleton to persist state
            services.AddSingleton<IAuthService, AuthService>();

            services.AddSingleton<FaceRecognitionService>();
            services.AddHttpClient<EmailNotificationService>(); // Register EmailService with HttpClient
            services.AddHttpClient<CloudStorageService>(); // Register CloudStorageService

            // Use local C# Vision Service with YOLO instead of remote backend
            services.AddSingleton<LocalVisionService>();
            services.AddSingleton<IVisionService>(p => p.GetRequiredService<LocalVisionService>());

            // Register ViewModels
            services.AddTransient<LoginViewModel>();
            services.AddTransient<MainViewModel>();
            
            // Register Views
            services.AddTransient<LoginWindow>();
            services.AddTransient<MainWindow>();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            // Cleanup
            if (ServiceProvider is IDisposable disposable)
            {
                disposable.Dispose();
            }
            base.OnExit(e);
        }
    }
}