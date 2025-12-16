using System;
using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace SentinelIntrusionDetection.Converters
{
    public class NullToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            bool isNull = value == null;
            if (parameter is string paramStr && paramStr.Equals("Inverse", StringComparison.OrdinalIgnoreCase))
            {
                // Invert behavior: Null -> Visible, Not Null -> Collapsed
                return isNull ? Visibility.Visible : Visibility.Collapsed;
            }
            // Standard behavior: Null -> Collapsed, Not Null -> Visible
            return isNull ? Visibility.Collapsed : Visibility.Visible;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }
}
