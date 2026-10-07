using System.Net.Http.Json;
using System.Text.Json;
using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Services;

/*
 PURPOSE:
 Central HTTP client for the native desktop application.
 REFERENCE:
 The WPF client never connects directly to the central SQL Server.
*/
public sealed class ApiService
{
    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _json = new() { PropertyNameCaseInsensitive = true };

    public ApiService(string baseUrl)
    {
        _http = new HttpClient
        {
            BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(5)
        };
    }

    public async Task<SessionInfo> LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var response = await _http.PostAsJsonAsync("api/auth/login", new { username, password }, ct);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SessionInfo>(_json, ct))!;
    }

    public async Task<SnapshotDto> GetSnapshotAsync(SessionInfo session, CancellationToken ct = default)
        => await _http.GetFromJsonAsync<SnapshotDto>($"api/sync/snapshot?tenantId={session.TenantId}&branchId={session.BranchId}", _json, ct) ?? new();

    public async Task<DashboardDto> GetDashboardAsync(SessionInfo session, CancellationToken ct = default)
        => await _http.GetFromJsonAsync<DashboardDto>($"api/dashboard?tenantId={session.TenantId}&branchId={session.BranchId}", _json, ct) ?? new();

    public async Task SubmitSaleAsync(SaleRequestDto sale, CancellationToken ct = default)
    {
        var response = await _http.PostAsJsonAsync("api/sales", sale, ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<PendingCashierDto>> GetPendingCashierAsync(SessionInfo session, CancellationToken ct = default)
        => await _http.GetFromJsonAsync<List<PendingCashierDto>>($"api/cashier/pending?tenantId={session.TenantId}&branchId={session.BranchId}", _json, ct) ?? [];

    public async Task CompleteCashierAsync(SessionInfo session, int saleId, string paymentMethod, CancellationToken ct = default)
    {
        var response = await _http.PutAsJsonAsync(
            $"api/cashier/{saleId}/complete",
            new { tenantId = session.TenantId, branchId = session.BranchId, paymentMethod },
            ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task<bool> IsAvailableAsync(SessionInfo? session = null)
    {
        try
        {
            if (session is null)
            {
                using var response = await _http.GetAsync("index.html");
                return response.IsSuccessStatusCode;
            }

            await GetDashboardAsync(session);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
