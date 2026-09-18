namespace PharmaCarePOS.Models;

/*
 PURPOSE:
 Defines the tenant/company record used by the SaaS layer.
 REFERENCE:
 Every operational record contains a TenantId so one pharmacy company cannot mix data with another.
*/
public class Tenant
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Plan { get; set; } = "Professional";
    public string Status { get; set; } = "Active";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

/*
 PURPOSE:
 Represents one pharmacy branch belonging to a tenant.
 REFERENCE:
 BranchId is carried on stock, sales and users so reporting can be separated per location.
*/
public class Branch
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
}

/*
 PURPOSE:
 Stores a demo login user.
 REFERENCE:
 PasswordHash is intentionally simplified for this demo package. Replace with ASP.NET Core Identity in production.
*/
public class AppUser
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Role { get; set; } = "Cashier";
}

/*
 PURPOSE:
 Stores the medicine master record.
 REFERENCE:
 Batch quantities and expiry dates are stored separately because the same product can have many batches.
*/
public class Product
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string GenericName { get; set; } = string.Empty;
    public string Strength { get; set; } = string.Empty;
    public string PackSize { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Brand { get; set; } = string.Empty;
    public string Barcode { get; set; } = string.Empty;
    public decimal SellingPrice { get; set; }
    public decimal PurchasePrice { get; set; }
    public bool TrackBatchExpiry { get; set; } = true;
    public bool RequiresPrescription { get; set; }
    public string RxNormId { get; set; } = string.Empty;
    public string ImageUrl { get; set; } = string.Empty;
    public string Manufacturer { get; set; } = string.Empty;
    public string DosageForm { get; set; } = string.Empty;
    public string Notes { get; set; } = string.Empty;
}

/*
 PURPOSE:
 Stores stock for one product batch at one branch.
 REFERENCE:
 POS sells by BatchId so the exact expiry date and remaining quantity are always known.
*/
public class StockBatch
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public int ProductId { get; set; }
    public string BatchNo { get; set; } = string.Empty;
    public DateTime ExpiryDate { get; set; }
    public decimal Quantity { get; set; }
    public decimal PurchasePrice { get; set; }
    public decimal SellingPrice { get; set; }
}

/*
 PURPOSE:
 Stores the sale header and an idempotency key supplied by the offline client.
 REFERENCE:
 ClientOperationId prevents duplicate invoices when an offline transaction is retried after reconnecting.
*/
public class Sale
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int BranchId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public string ClientOperationId { get; set; } = string.Empty;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal Total { get; set; }
    public string PaymentMethod { get; set; } = "Cash";
    public int? CustomerId { get; set; }
}

/*
 PURPOSE:
 Stores one sold medicine/batch line for an invoice.
 REFERENCE:
 Product and batch text are duplicated here so historical invoices remain readable even if master data changes later.
*/
public class SaleLine
{
    public int Id { get; set; }
    public int SaleId { get; set; }
    public int ProductId { get; set; }
    public int BatchId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string BatchNo { get; set; } = string.Empty;
    public DateTime ExpiryDate { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal LineTotal { get; set; }
}

/*
 PURPOSE:
 Stores suppliers used by purchase/GRN screens.
 REFERENCE:
 Supplier records are tenant-scoped SaaS data.
*/
public class Supplier
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ContactPerson { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
}

/*
 PURPOSE:
 Stores customers/patients for purchase history and optional invoice assignment.
 REFERENCE:
 Medical clinical records are outside this demo; this is a commercial customer profile only.
*/
public class Customer
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime? DateOfBirth { get; set; }
    public string Sex { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string Allergies { get; set; } = string.Empty;
    public string MedicalConditions { get; set; } = string.Empty;
    public string CurrentMedications { get; set; } = string.Empty;
    public string DoctorName { get; set; } = string.Empty;
    public string DoctorPhone { get; set; } = string.Empty;
    public string EmergencyContactName { get; set; } = string.Empty;
    public string EmergencyContactRelationship { get; set; } = string.Empty;
    public string EmergencyContactPhone { get; set; } = string.Empty;
    public string Notes { get; set; } = string.Empty;
}

/*
 PURPOSE:
 Stores the SaaS subscription plan catalogue.
 REFERENCE:
 Platform administrators can map tenants to plans without changing pharmacy transaction records.
*/
public class SaaSPlan
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public decimal MonthlyPrice { get; set; }
    public int BranchLimit { get; set; }
    public int UserLimit { get; set; }
}


/*
 PURPOSE:
 Stores simple tenant-level pharmacy settings used by invoice, currency and expiry screens.
 REFERENCE:
 Keeping settings in the server database makes them available after another device logs in.
*/
public class PharmacySetting
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string PharmacyName { get; set; } = string.Empty;
    public string Address { get; set; } = string.Empty;
    public string Currency { get; set; } = "USD";
    public string InvoicePrefix { get; set; } = "INV";
    public int ExpiryAlertDays { get; set; } = 60;
}
