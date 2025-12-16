using SentinelIntrusionDetection.Models;
using System.Threading.Tasks;

namespace SentinelIntrusionDetection.Services
{
    public interface IAuthService
    {
        Task<LoginResponse> InitiateLoginAsync();
        Task<TokenStatusResponse> CheckTokenStatusAsync(string sessionId);
        Task<bool> VerifyTokenAsync(string accessToken);
        string? GetAccessToken();
        UserInfo? GetCurrentUser();
        void SaveToken(string accessToken, UserInfo user);
        void ClearToken();
        bool IsAuthenticated();
    }
}