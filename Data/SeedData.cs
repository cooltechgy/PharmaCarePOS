using Microsoft.EntityFrameworkCore;
using PharmaCarePOS.Models;

namespace PharmaCarePOS.Data;

public static class SeedData
{
    /*
     PURPOSE:
     Creates the demo database and realistic pharmacy records on first run.
     REFERENCE:
     This method is for local demonstration only. Production deployments should use EF Core migrations and secure provisioning.
    */
    public static async Task InitializeAsync(AppDbContext db)
    {
        await db.Database.EnsureCreatedAsync();
        if (await db.Tenants.AnyAsync()) return;

        var tenant = new Tenant { Code = "pharmacare", Name = "PharmaCare Pharmacy", Plan = "Professional", Status = "Active" };
        var platform = new Tenant { Code = "platform", Name = "PharmaCare SaaS Platform", Plan = "Platform", Status = "Active" };
        db.Tenants.AddRange(tenant, platform);
        await db.SaveChangesAsync();

        var branch = new Branch { TenantId = tenant.Id, Name = "Main Branch", Address = "Georgetown" };
        db.Branches.Add(branch);
        await db.SaveChangesAsync();

        db.PharmacySettings.Add(new PharmacySetting { TenantId = tenant.Id, PharmacyName = tenant.Name, Address = "Main Branch, Georgetown", Currency = "GYD", InvoicePrefix = "INV", ExpiryAlertDays = 60 });

        db.Users.AddRange(
            new AppUser { TenantId = tenant.Id, BranchId = branch.Id, Username = "admin", PasswordHash = "Admin123!", DisplayName = "John Doe", Role = "Pharmacist" },
            new AppUser { TenantId = platform.Id, BranchId = 0, Username = "superadmin", PasswordHash = "SaaS123!", DisplayName = "Platform Admin", Role = "PlatformAdmin" }
        );

        db.SaaSPlans.AddRange(
            new SaaSPlan { Name = "Starter", MonthlyPrice = 39, BranchLimit = 1, UserLimit = 3 },
            new SaaSPlan { Name = "Professional", MonthlyPrice = 89, BranchLimit = 5, UserLimit = 20 },
            new SaaSPlan { Name = "Enterprise", MonthlyPrice = 199, BranchLimit = 50, UserLimit = 250 }
        );

        var products = new[]
        {
            new Product { TenantId = tenant.Id, Name = "Paracetamol 500mg", GenericName = "Paracetamol", Strength = "500mg", PackSize = "10 Tablets", Category = "Analgesic", Brand = "MediCare", Barcode = "1000001", SellingPrice = 1.50m, PurchasePrice = 0.80m },
            new Product { TenantId = tenant.Id, Name = "Cetirizine 10mg", GenericName = "Cetirizine", Strength = "10mg", PackSize = "10 Tablets", Category = "Antihistamine", Brand = "Zyrtec", Barcode = "1000002", SellingPrice = 12.00m, PurchasePrice = 8.00m },
            new Product { TenantId = tenant.Id, Name = "Amoxicillin 500mg", GenericName = "Amoxicillin", Strength = "500mg", PackSize = "10 Capsules", Category = "Antibiotic", Brand = "Amoxil", Barcode = "1000003", SellingPrice = 45.00m, PurchasePrice = 25.00m, RequiresPrescription = true },
            new Product { TenantId = tenant.Id, Name = "Omeprazole 20mg", GenericName = "Omeprazole", Strength = "20mg", PackSize = "10 Capsules", Category = "Gastro", Brand = "Omez", Barcode = "1000004", SellingPrice = 30.00m, PurchasePrice = 18.00m },
            new Product { TenantId = tenant.Id, Name = "Azithromycin 500mg", GenericName = "Azithromycin", Strength = "500mg", PackSize = "3 Tablets", Category = "Antibiotic", Brand = "Azithral", Barcode = "1000005", SellingPrice = 60.00m, PurchasePrice = 38.00m, RequiresPrescription = true },
            new Product { TenantId = tenant.Id, Name = "Metformin 500mg", GenericName = "Metformin", Strength = "500mg", PackSize = "30 Tablets", Category = "Diabetes", Brand = "Gluco", Barcode = "1000006", SellingPrice = 22.00m, PurchasePrice = 13.50m }
        };
        db.Products.AddRange(products);
        await db.SaveChangesAsync();

        var now = DateTime.Today;
        db.StockBatches.AddRange(
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[0].Id, BatchNo = "PT001", ExpiryDate = now.AddMonths(14), Quantity = 120, PurchasePrice = .80m, SellingPrice = 1.50m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[0].Id, BatchNo = "PT002", ExpiryDate = now.AddMonths(26), Quantity = 40, PurchasePrice = .82m, SellingPrice = 1.50m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[1].Id, BatchNo = "CT405", ExpiryDate = now.AddDays(17), Quantity = 5, PurchasePrice = 8m, SellingPrice = 12m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[2].Id, BatchNo = "AMX123", ExpiryDate = now.AddMonths(8), Quantity = 100, PurchasePrice = 25m, SellingPrice = 45m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[3].Id, BatchNo = "OME789", ExpiryDate = now.AddDays(27), Quantity = 10, PurchasePrice = 18m, SellingPrice = 30m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[4].Id, BatchNo = "AZI321", ExpiryDate = now.AddDays(39), Quantity = 2, PurchasePrice = 38m, SellingPrice = 60m },
            new StockBatch { TenantId = tenant.Id, BranchId = branch.Id, ProductId = products[5].Id, BatchNo = "MET901", ExpiryDate = now.AddMonths(18), Quantity = 75, PurchasePrice = 13.5m, SellingPrice = 22m }
        );

        db.Suppliers.AddRange(
            new Supplier { TenantId = tenant.Id, Name = "Sun Pharma Distributors", ContactPerson = "Mr. Sharma", Phone = "592-600-1001", Email = "sales@sunpharma.demo" },
            new Supplier { TenantId = tenant.Id, Name = "Alem Laboratories", ContactPerson = "Mr. Mehta", Phone = "592-600-1002", Email = "sales@alem.demo" },
            new Supplier { TenantId = tenant.Id, Name = "Cipla Ltd", ContactPerson = "Mr. Verma", Phone = "592-600-1003", Email = "sales@cipla.demo" }
        );

        db.Customers.AddRange(
            new Customer { TenantId = tenant.Id, Name = "Rajesh Kumar", DateOfBirth = new DateTime(1978,5,14), Sex = "Male", Phone = "592-610-2001", Email = "rajesh@example.com", Address = "Georgetown", Allergies = "Penicillin", MedicalConditions = "Hypertension", CurrentMedications = "Amlodipine 5mg", DoctorName = "Dr. Singh", DoctorPhone = "592-555-3100", EmergencyContactName = "Anita Kumar", EmergencyContactRelationship = "Spouse", EmergencyContactPhone = "592-611-9090", Notes = "Verify allergy before antibiotic dispensing." },
            new Customer { TenantId = tenant.Id, Name = "Priya Sharma", DateOfBirth = new DateTime(1987,9,3), Sex = "Female", Phone = "592-610-2002", Email = "priya@example.com", Address = "East Bank Demerara", MedicalConditions = "Asthma", CurrentMedications = "Salbutamol inhaler", EmergencyContactName = "Arun Sharma", EmergencyContactRelationship = "Brother", EmergencyContactPhone = "592-612-1000" },
            new Customer { TenantId = tenant.Id, Name = "Amit Patel", Phone = "592-610-2003", Email = "amit@example.com" }
        );

        await db.SaveChangesAsync();

        /*
         PURPOSE:
         Seeds one linked patient invoice so medicine-history and product-sales-history screens show a real example immediately.
         REFERENCE:
         Sale.CustomerId links the invoice to the patient; SaleLine links it to the medicine and batch.
        */
        var rajesh = await db.Customers.FirstAsync(x => x.TenantId == tenant.Id && x.Name == "Rajesh Kumar");
        var sampleSale = new Sale
        {
            TenantId = tenant.Id, BranchId = branch.Id, CustomerId = rajesh.Id, ClientOperationId = "SEED-HISTORY-001",
            InvoiceNo = "INV-DEMO-001", CreatedUtc = DateTime.UtcNow.AddDays(-5), Subtotal = 3.00m, Total = 3.00m, PaymentMethod = "Cash"
        };
        db.Sales.Add(sampleSale);
        await db.SaveChangesAsync();
        db.SaleLines.Add(new SaleLine
        {
            SaleId = sampleSale.Id, ProductId = products[0].Id, BatchId = 1, ProductName = products[0].Name, BatchNo = "PT001",
            ExpiryDate = now.AddMonths(14), Quantity = 2, UnitPrice = 1.50m, LineTotal = 3.00m
        });
        await db.SaveChangesAsync();
    }
}
