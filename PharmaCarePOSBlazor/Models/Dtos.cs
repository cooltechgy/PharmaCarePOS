namespace PharmaCarePOSBlazor.Models;

public sealed class SessionInfo
{
    public int UserId { get; set; }
    public int TenantId { get; set; }
    public string TenantCode { get; set; } = "";
    public string TenantName { get; set; } = "";
    public int BranchId { get; set; }
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
}

public sealed class DashboardDto
{
    public decimal SalesToday { get; set; }
    public int SalesCount { get; set; }
    public int LowStock { get; set; }
    public int ExpirySoon { get; set; }
}

public sealed class ProductDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string GenericName { get; set; } = "";
    public string Strength { get; set; } = "";
    public string PackSize { get; set; } = "";
    public string Category { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Barcode { get; set; } = "";
    public decimal SellingPrice { get; set; }
    public decimal PurchasePrice { get; set; }
    public bool TrackBatchExpiry { get; set; } = true;
    public bool RequiresPrescription { get; set; }
    public string RxNormId { get; set; } = "";
    public string ImageUrl { get; set; } = "";
    public string Manufacturer { get; set; } = "";
    public string DosageForm { get; set; } = "";
    public string Notes { get; set; } = "";
}

public sealed class StockRow
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public string ProductName { get; set; } = "";
    public string BatchNo { get; set; } = "";
    public DateTime ExpiryDate { get; set; }
    public decimal Quantity { get; set; }
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
}

public class CustomerDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public DateTime? DateOfBirth { get; set; }
    public string Sex { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string Address { get; set; } = "";
    public string Allergies { get; set; } = "";
    public string MedicalConditions { get; set; } = "";
    public string CurrentMedications { get; set; } = "";
    public string DoctorName { get; set; } = "";
    public string DoctorPhone { get; set; } = "";
    public string EmergencyContactName { get; set; } = "";
    public string EmergencyContactRelationship { get; set; } = "";
    public string EmergencyContactPhone { get; set; } = "";
    public string Notes { get; set; } = "";
}

public class SupplierDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string ContactPerson { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
}

public sealed class PendingCashierDto
{
    public int Id { get; set; }
    public string InvoiceNo { get; set; } = "";
    public decimal Total { get; set; }
    public string CustomerName { get; set; } = "";
    public string SuggestedPaymentMethod { get; set; } = "Cash";
    public string PaymentStatus { get; set; } = "Pending";
}

public sealed class CartLine
{
    public int ProductId { get; set; }
    public int BatchId { get; set; }
    public string ProductName { get; set; } = "";
    public string BatchNo { get; set; } = "";
    public decimal Quantity { get; set; } = 1;
    public decimal MaxQty { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Total => Quantity * UnitPrice;
}

public sealed class SaleRequestDto
{
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public string ClientOperationId { get; set; } = Guid.NewGuid().ToString("N");
    public decimal Discount { get; set; }
    public string PaymentMethod { get; set; } = "Cash";
    public int? CustomerId { get; set; }
    public List<SaleLineRequestDto> Lines { get; set; } = [];
}

public sealed class SaleLineRequestDto
{
    public int BatchId { get; set; }
    public decimal Quantity { get; set; }
}

public sealed class ProductRequest
{
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string GenericName { get; set; } = "";
    public string Strength { get; set; } = "";
    public string PackSize { get; set; } = "";
    public string Category { get; set; } = "";
    public string Brand { get; set; } = "";
    public string Barcode { get; set; } = "";
    public decimal SellingPrice { get; set; }
    public decimal PurchasePrice { get; set; }
    public bool TrackBatchExpiry { get; set; } = true;
    public bool RequiresPrescription { get; set; }
    public string? RxNormId { get; set; }
    public string? ImageUrl { get; set; }
    public string? Manufacturer { get; set; }
    public string? DosageForm { get; set; }
    public string? Notes { get; set; }
}

public sealed class CustomerRequest : CustomerDto { }
public sealed class SupplierRequest : SupplierDto { }

public sealed class PurchaseRequest
{
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public int? SupplierId { get; set; }
    public List<PurchaseLineRequest> Lines { get; set; } = [];
}
public sealed class PurchaseLineRequest
{
    public int ProductId { get; set; }
    public string BatchNo { get; set; } = "";
    public DateTime ExpiryDate { get; set; } = DateTime.Today.AddMonths(12);
    public decimal Quantity { get; set; }
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
}

public sealed class UserDto
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
    public int BranchId { get; set; }
}
public sealed class BranchDto
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Address { get; set; } = "";
}
public sealed class UserCreateRequest
{
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "Cashier";
}

public sealed class SettingsDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string PharmacyName { get; set; } = "";
    public string Address { get; set; } = "";
    public string Currency { get; set; } = "USD";
    public string InvoicePrefix { get; set; } = "INV";
    public int ExpiryAlertDays { get; set; } = 60;
}
public sealed class SettingsRequest
{
    public int TenantId { get; set; }
    public string PharmacyName { get; set; } = "";
    public string Address { get; set; } = "";
    public string Currency { get; set; } = "USD";
    public string InvoicePrefix { get; set; } = "INV";
    public int ExpiryAlertDays { get; set; } = 60;
}

public sealed class SalesReportDto
{
    public List<SaleDto> Sales { get; set; } = [];
    public List<SaleLineDto> Lines { get; set; } = [];
}
public sealed class SaleDto
{
    public int Id { get; set; }
    public string InvoiceNo { get; set; } = "";
    public DateTime CreatedUtc { get; set; }
    public decimal Total { get; set; }
    public string PaymentMethod { get; set; } = "";
    public int? CustomerId { get; set; }
}
public sealed class SaleLineDto
{
    public int SaleId { get; set; }
    public string ProductName { get; set; } = "";
    public decimal Quantity { get; set; }
    public decimal LineTotal { get; set; }
}
