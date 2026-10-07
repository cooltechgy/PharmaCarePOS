using System.Text.Json.Serialization;

namespace PharmaCarePOS.Desktop.Models;

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

public sealed class ProductDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string GenericName { get; set; } = "";
    public string Strength { get; set; } = "";
    public string DosageForm { get; set; } = "";
    public string Category { get; set; } = "";
    public string Barcode { get; set; } = "";
    public decimal SellingPrice { get; set; }
    public decimal PurchasePrice { get; set; }
}

public sealed class BatchDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public int ProductId { get; set; }
    public string BatchNo { get; set; } = "";
    public DateTime ExpiryDate { get; set; }
    public decimal Quantity { get; set; }
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
}

public sealed class CustomerDto
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = "";
    public string Phone { get; set; } = "";
    public string Email { get; set; } = "";
    public string Allergies { get; set; } = "";
}

public sealed class SnapshotDto
{
    public List<ProductDto> Products { get; set; } = [];
    public List<BatchDto> Batches { get; set; } = [];
    public List<CustomerDto> Customers { get; set; } = [];
    public DateTime ServerUtc { get; set; }
}

public sealed class DashboardDto
{
    public decimal SalesToday { get; set; }
    public int SalesCount { get; set; }
    public int LowStock { get; set; }
    public int ExpirySoon { get; set; }
}

public sealed class SaleLineRequestDto
{
    public int BatchId { get; set; }
    public decimal Quantity { get; set; }
}

public sealed class SaleRequestDto
{
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public string ClientOperationId { get; set; } = "";
    public decimal Discount { get; set; }
    public string PaymentMethod { get; set; } = "Cash";
    public int? CustomerId { get; set; }
    public List<SaleLineRequestDto> Lines { get; set; } = [];
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
    public DateTime ExpiryDate { get; set; }
    public decimal Quantity { get; set; } = 1;
    public decimal MaxQty { get; set; }
    public decimal UnitPrice { get; set; }

    [JsonIgnore]
    public decimal LineTotal => Quantity * UnitPrice;
}
