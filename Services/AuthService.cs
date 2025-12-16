using Newtonsoft.Json;
using SentinelIntrusionDetection.Models;
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

namespace SentinelIntrusionDetection.Services
{
    public class AuthService : IAuthService
    {
        private readonly HttpClient _httpClient;
        private string? _accessToken;
        private UserInfo? _currentUser;

        public AuthService(IHttpClientFactory httpClientFactory)
        {
            _httpClient = httpClientFactory.CreateClient();
            // WPF talks ONLY to local backend
            _httpClient.BaseAddress = new Uri("http://localhost:5000/");
        }

        public async Task<LoginResponse> InitiateLoginAsync()
        {
            try
            {
                // Local backend will handle communication with Sentinel
                // and return the Vercel frontend URL for the user to authenticate
                var response = await _httpClient.GetAsync("login");
                response.EnsureSuccessStatusCode();
                var content = await response.Content.ReadAsStringAsync();

                var result = JsonConvert.DeserializeObject<LoginResponse>(content);

                // The AuthUrl should already be pointing to https://sentinelauth.vercel.app/...
                // from your local backend

                return result ?? new LoginResponse { Success = false };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Login initiation error: {ex.Message}");
                return new LoginResponse { Success = false, Message = ex.Message };
            }
        }

        public async Task<TokenStatusResponse> CheckTokenStatusAsync(string sessionId)
        {
            try
            {
                // Check with local backend, which will check with Sentinel
                var response = await _httpClient.GetAsync($"token-status/{sessionId}");
                response.EnsureSuccessStatusCode();
                var content = await response.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<TokenStatusResponse>(content) ?? new TokenStatusResponse { Success = false };
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Token status check error: {ex.Message}");
                return new TokenStatusResponse { Success = false, Message = ex.Message };
            }
        }

        public async Task<bool> VerifyTokenAsync(string accessToken)
        {
            try
            {
                var payload = new { accessToken };
                var content = new StringContent(
                    JsonConvert.SerializeObject(payload),
                    Encoding.UTF8,
                    "application/json"
                );
                var response = await _httpClient.PostAsync("verify-token", content);
                response.EnsureSuccessStatusCode();
                var result = await response.Content.ReadAsStringAsync();
                dynamic? json = JsonConvert.DeserializeObject(result);
                return json?.valid == true;
            }
            catch
            {
                return false;
            }
        }

        public void SaveToken(string accessToken, UserInfo user)
        {
            _accessToken = accessToken;
            _currentUser = user;
        }

        public void ClearToken()
        {
            _accessToken = null;
            _currentUser = null;
        }

        public string? GetAccessToken() => _accessToken;

        public UserInfo? GetCurrentUser() => _currentUser;

        public bool IsAuthenticated() => !string.IsNullOrEmpty(_accessToken);
    }
}