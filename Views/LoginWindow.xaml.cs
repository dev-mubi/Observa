using SentinelIntrusionDetection.ViewModels;
using System.Windows;

namespace SentinelIntrusionDetection.Views
{
    public partial class LoginWindow : Window
    {
        public LoginWindow(LoginViewModel viewModel)
        {
            InitializeComponent();
            DataContext = viewModel;
        }
    }
}