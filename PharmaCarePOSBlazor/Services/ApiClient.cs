using System.Net.Http.Json;
using System.Text.Json;
using PharmaCarePOSBlazor.Models;

namespace PharmaCarePOSBlazor.Services;

public sealed class ApiClient
{
    private readonly HttpClient _http;
    private readonly JsonSerializerOptions _json = new() { PropertyNameCaseInsensitive = true };

    public ApiClient(HttpClient http) => _http = http;

    public async Task<SessionInfo> LoginAsync(string username, string password)
    {
        var response = await _http.PostAsJsonAsync("api/auth/login", new { username, password });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SessionInfo>(_json))!;
    }

    public Task<DashboardDto?> DashboardAsync(SessionInfo s) =>
        _http.GetFromJsonAsync<DashboardDto>($"api/dashboard?tenantId={s.TenantId}&branchId={s.BranchId}", _json);

    public async Task<List<ProductDto>> ProductsAsync(int tenantId) =>
        await _http.GetFromJsonAsync<List<ProductDto>>($"api/products?tenantId={tenantId}", _json) ?? [];

    public async Task SaveProductAsync(ProductRequest request, int? id = null)
    {
        var response = id is null
            ? await _http.PostAsJsonAsync("api/products", request)
            : await _http.PutAsJsonAsync($"api/products/{id}", request);
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<StockRow>> StockAsync(SessionInfo s) =>
        await _http.GetFromJsonAsync<List<StockRow>>($"api/stock?tenantId={s.TenantId}&branchId={s.BranchId}", _json) ?? [];

    public async Task<List<CustomerDto>> CustomersAsync(int tenantId) =>
        await _http.GetFromJsonAsync<List<CustomerDto>>($"api/customers?tenantId={tenantId}", _json) ?? [];

    public async Task SaveCustomerAsync(CustomerRequest request, int? id = null)
    {
        var response = id is null
            ? await _http.PostAsJsonAsync("api/customers", request)
            : await _http.PutAsJsonAsync($"api/customers/{id}", request);
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<SupplierDto>> SuppliersAsync(int tenantId) =>
        await _http.GetFromJsonAsync<List<SupplierDto>>($"api/suppliers?tenantId={tenantId}", _json) ?? [];

    public async Task SaveSupplierAsync(SupplierRequest request, int? id = null)
    {
        var response = id is null
            ? await _http.PostAsJsonAsync("api/suppliers", request)
            : await _http.PutAsJsonAsync($"api/suppliers/{id}", request);
        response.EnsureSuccessStatusCode();
    }

    public async Task SubmitSaleAsync(SaleRequestDto request)
    {
        var response = await _http.PostAsJsonAsync("api/sales", request);
        response.EnsureSuccessStatusCode();
    }

    public async Task SubmitPurchaseAsync(PurchaseRequest request)
    {
        var response = await _http.PostAsJsonAsync("api/purchases", request);
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<PendingCashierDto>> PendingCashierAsync(SessionInfo s) =>
        await _http.GetFromJsonAsync<List<PendingCashierDto>>($"api/cashier/pending?tenantId={s.TenantId}&branchId={s.BranchId}", _json) ?? [];

    public async Task CompleteCashierAsync(SessionInfo s, int saleId, string method)
    {
        var response = await _http.PutAsJsonAsync($"api/cashier/{saleId}/complete",
            new { tenantId = s.TenantId, branchId = s.BranchId, paymentMethod = method });
        response.EnsureSuccessStatusCode();
    }

    public async Task<List<UserDto>> UsersAsync(int tenantId) =>
        await _http.GetFromJsonAsync<List<UserDto>>($"api/users?tenantId={tenantId}", _json) ?? [];

    public async Task<List<BranchDto>> BranchesAsync(int tenantId) =>
        await _http.GetFromJsonAsync<List<BranchDto>>($"api/branches?tenantId={tenantId}", _json) ?? [];

    public async Task CreateUserAsync(UserCreateRequest request)
    {
        var response = await _http.PostAsJsonAsync("api/users", request);
        response.EnsureSuccessStatusCode();
    }

    public Task<SettingsDto?> SettingsAsync(int tenantId) =>
        _http.GetFromJsonAsync<SettingsDto>($"api/settings?tenantId={tenantId}", _json);

    public async Task SaveSettingsAsync(SettingsRequest request)
    {
        var response = await _http.PutAsJsonAsync("api/settings", request);
        response.EnsureSuccessStatusCode();
    }

    public Task<SalesReportDto?> SalesReportAsync(SessionInfo s) =>
        _http.GetFromJsonAsync<SalesReportDto>($"api/reports/sales?tenantId={s.TenantId}&branchId={s.BranchId}", _json);
}
