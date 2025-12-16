using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Threading.Tasks;

namespace SentinelIntrusionDetection.Services
{
    public class CloudStorageService
    {
        private readonly HttpClient _httpClient;
        // Base URL for your Express Server
        private const string BaseUrl = "http://localhost:5000/api"; 

        public CloudStorageService(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public async Task<string?> UploadEventImageAsync(byte[] imageBytes, string userEmail)
        {
            try
            {
                // 1. Generate unique filename
                string timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
                string filename = $"evidence_{userEmail}_{timestamp}.jpg";

                // 2. Request Signed Upload URL from Server
                var urlResponse = await _httpClient.PostAsJsonAsync($"{BaseUrl}/generate-upload-url", new { filename });
                
                if (!urlResponse.IsSuccessStatusCode)
                {
                    Console.WriteLine($"[CLOUD] Failed to get upload URL: {urlResponse.StatusCode}");
                    return null;
                }

                var urlData = await urlResponse.Content.ReadFromJsonAsync<UploadUrlResponse>();
                if (urlData == null || !urlData.Success) return null;

                // 3. Upload Image to Supabase (PUT to signed URL)
                using (var content = new ByteArrayContent(imageBytes))
                {
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("image/jpeg");
                    var uploadResponse = await _httpClient.PutAsync(urlData.UploadUrl, content);

                    if (!uploadResponse.IsSuccessStatusCode)
                    {
                        Console.WriteLine($"[CLOUD] Upload failed: {uploadResponse.StatusCode}");
                        return null;
                    }
                }

                Console.WriteLine($"[CLOUD] ✓ Image uploaded: {filename}");
                return urlData.Path; // Return the path for logging
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CLOUD] Upload error: {ex.Message}");
                return null;
            }
        }

        public async Task LogEventAsync(string userEmail, string imagePath, double confidence)
        {
            try
            {
                var eventData = new
                {
                    user_email = userEmail,
                    image_path = imagePath,
                    timestamp = DateTime.UtcNow,
                    confidence = confidence
                };

                var response = await _httpClient.PostAsJsonAsync($"{BaseUrl}/log-event", eventData);
                if (response.IsSuccessStatusCode)
                {
                    Console.WriteLine("[CLOUD] ✓ Event logged to Supabase");
                }
                else
                {
                    Console.WriteLine($"[CLOUD] Log event failed: {response.StatusCode}");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[CLOUD] Log error: {ex.Message}");
            }
        }

        // Response Models
        private class UploadUrlResponse
        {
            public bool Success { get; set; }
            public string UploadUrl { get; set; }
            public string Path { get; set; }
            public string PublicUrl { get; set; }
        }
    }
}
