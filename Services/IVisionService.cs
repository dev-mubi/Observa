using SentinelIntrusionDetection.Models;
using System.Threading.Tasks;

namespace SentinelIntrusionDetection.Services
{
    public interface IVisionService
    {
        Task<VisionStartResponse> StartMonitoringAsync(string mode, string userId);
        Task<VisionStopResponse> StopMonitoringAsync();
        Task<VisionStatusResponse> GetStatusAsync();
        Task<VisionFrameResponse?> GetCurrentFrameAsync();
    }
}