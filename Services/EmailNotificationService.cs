using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace SentinelIntrusionDetection.Services
{
    /// <summary>
    /// Email notification service for unknown face alerts
    /// Sends alerts via Node.js server using Gmail SMTP
    /// CRITICAL: 5-minute cooldown to prevent spam
    /// </summary>
    public class EmailNotificationService
    {
        private readonly HttpClient _httpClient;
        private readonly string _serverUrl = "https://monitor-my-space-server.onrender.com";


        public EmailNotificationService(HttpClient httpClient)
        {
            _httpClient = httpClient;
            _httpClient.BaseAddress = new Uri(_serverUrl);
            Console.WriteLine($"✓ Email notification service initialized (Server: {_serverUrl})");
        }

        /// <summary>
        /// Send unknown face alert email
        /// Enforces 5-minute cooldown to prevent spam
        /// </summary>
        /// <param name="userEmail">Recipient email (from authenticated user)</param>
        /// <param name="snapshotBase64">Base64 encoded full frame snapshot</param>
        /// <param name="faceImageBase64">Base64 encoded detected face region</param>
        /// <param name="faceLocation">Face bounding box coordinates</param>
        /// <returns>True if email sent, false if cooldown active or failed</returns>
        public async Task<bool> SendUnknownFaceAlertAsync(
            string userEmail,
            string snapshotBase64,
            string? faceImageBase64,
            FaceLocation faceLocation)
        {
            // Server-side rate limiting is now used.
            // We just send the alert, and the server decides whether to ignore, log, or send summary.

            try
            {
                var payload = new EmailAlertPayload
                {
                    UserId = userEmail,
                    Timestamp = DateTime.Now,
                    Reason = "Unknown face detected",
                    SnapshotBase64 = snapshotBase64,
                    FaceImageBase64 = faceImageBase64 ?? snapshotBase64,
                    Location = faceLocation
                };

                Console.WriteLine($"📧 Sending unknown face alert to {userEmail}...");

                var response = await _httpClient.PostAsJsonAsync("/send-alert", payload);

                if (response.IsSuccessStatusCode)
                {
                    var result = await response.Content.ReadFromJsonAsync<EmailResponse>();
                    
                    Console.WriteLine($"✅ Email sent successfully! MessageID: {result?.MessageId}");
                    
                    return true;
                }
                else
                {
                    var errorText = await response.Content.ReadAsStringAsync();
                    Console.WriteLine($"❌ Email send failed: {response.StatusCode} - {errorText}");
                    return false;
                }
            }
            catch (HttpRequestException ex)
            {
                Console.WriteLine($"❌ Email server connection error: {ex.Message}");
                Console.WriteLine($"⚠️ Is Node.js server running on {_serverUrl}?");
                return false;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Email send error: {ex.Message}");
                return false;
            }
        }

        // Helper methods for cooldown removed - logic moved to server
    }

    /// <summary>
    /// Face location coordinates for email payload
    /// </summary>
    public class FaceLocation
    {
        [JsonPropertyName("x")]
        public int X { get; set; }

        [JsonPropertyName("y")]
        public int Y { get; set; }

        [JsonPropertyName("width")]
        public int Width { get; set; }

        [JsonPropertyName("height")]
        public int Height { get; set; }
    }

    /// <summary>
    /// Payload sent to Node.js /send-alert endpoint
    /// </summary>
    internal class EmailAlertPayload
    {
        [JsonPropertyName("toEmail")]
        public string UserId { get; set; } = string.Empty;

        [JsonPropertyName("timestamp")]
        public DateTime Timestamp { get; set; }

        [JsonPropertyName("reason")]
        public string Reason { get; set; } = string.Empty;

        [JsonPropertyName("frameImage")]
        public string SnapshotBase64 { get; set; } = string.Empty;

        [JsonPropertyName("faceImage")]
        public string FaceImageBase64 { get; set; } = string.Empty;

        [JsonPropertyName("location")]
        public FaceLocation Location { get; set; } = new FaceLocation();
    }

    /// <summary>
    /// Response from Node.js /send-alert endpoint
    /// </summary>
    internal class EmailResponse
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("messageId")]
        public string? MessageId { get; set; }

        [JsonPropertyName("message")]
        public string? Message { get; set; }
    }
}
