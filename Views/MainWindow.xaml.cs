using Microsoft.Extensions.DependencyInjection;
using SentinelIntrusionDetection.ViewModels;
using SentinelIntrusionDetection.Views;
using System.Windows;

namespace SentinelIntrusionDetection.Views
{
    public partial class MainWindow : Window
    {
        public MainWindow(MainViewModel viewModel)
        {
            InitializeComponent();
            DataContext = viewModel;
        }



        private void CheckBox_Checked(object sender, RoutedEventArgs e)
        {

        }
    }
}