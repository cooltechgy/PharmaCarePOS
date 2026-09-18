using Microsoft.EntityFrameworkCore;
using PharmaCarePOS.Data;
using PharmaCarePOS.Models;

var builder = WebApplication.CreateBuilder(args);

/*
 PURPOSE:
 Registers Microsoft SQL Server as the local/central database.
 REFERENCE:
 One ASP.NET Core process serves both the SaaS API and the offline-capable POS web application.
*/
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("Default") ?? "Server=(localdb)\\MSSQLLocalDB;Database=PharmaCarePOS;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true"));
builder.Services.AddHttpClient();

var app = builder.Build();

/*
 PURPOSE:
 Makes wwwroot files available as the application UI and enables default index.html routing.
 REFERENCE:
 The SPA is deliberately framework-light so a beginner can trace the HTML/CSS/JavaScript easily.
*/
app.UseDefaultFiles();
app.UseStaticFiles();

/*
 PURPOSE:
 Seeds a working pharmacy tenant, branch, users, products and batches on first startup.
 REFERENCE:
 This makes the package usable immediately after `dotnet run`.
*/
using (var scope = app.Services.CreateScope())
{
    await SeedData.InitializeAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
}

/*
 PURPOSE:
 Validates the demo login and returns the tenant/branch context used by the browser.
 REFERENCE:
 Replace this simple password comparison with ASP.NET Core Identity before production deployment.
*/
app.MapPost("/api/auth/login", async (LoginRequest request, AppDbContext db) =>
{
    var tenant = await db.Tenants.FirstOrDefaultAsync(x => x.Code == request.TenantCode);
    if (tenant is null) return Results.Unauthorized();

    var user = await db.Users.FirstOrDefaultAsync(x => x.TenantId == tenant.Id && x.Username == request.Username && x.PasswordHash == request.Password);
    if (user is null) return Results.Unauthorized();

    return Results.Ok(new
    {
        tenantId = tenant.Id,
        tenantCode = tenant.Code,
        tenantName = tenant.Name,
        branchId = user.BranchId,
        displayName = user.DisplayName,
        role = user.Role
    });
});

/*
 PURPOSE:
 Returns all working data needed by the POS so the browser can cache it for offline use.
 REFERENCE:
 The client saves this snapshot into IndexedDB after a successful online login/sync.
*/
app.MapGet("/api/sync/snapshot", async (int tenantId, int branchId, AppDbContext db) =>
{
    var products = await db.Products.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync();
    var batches = await db.StockBatches.Where(x => x.TenantId == tenantId && x.BranchId == branchId).OrderBy(x => x.ExpiryDate).ToListAsync();
    var customers = await db.Customers.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync();
    var suppliers = await db.Suppliers.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync();

    return Results.Ok(new { products, batches, customers, suppliers, serverUtc = DateTime.UtcNow });
});

/*
 PURPOSE:
 Returns dashboard totals and expiry/low-stock summary cards.
 REFERENCE:
 Values are calculated from the tenant/branch central data so online dashboards reflect server truth.
*/
app.MapGet("/api/dashboard", async (int tenantId, int branchId, AppDbContext db) =>
{
    var today = DateTime.UtcNow.Date;
    var tomorrow = today.AddDays(1);
    var todaySales = await db.Sales.Where(x => x.TenantId == tenantId && x.BranchId == branchId && x.CreatedUtc >= today && x.CreatedUtc < tomorrow).ToListAsync();
    var salesToday = todaySales.Sum(x => x.Total);
    var salesCount = todaySales.Count;
    var lowStock = await db.StockBatches.CountAsync(x => x.TenantId == tenantId && x.BranchId == branchId && x.Quantity <= 10);
    var expirySoon = await db.StockBatches.CountAsync(x => x.TenantId == tenantId && x.BranchId == branchId && x.ExpiryDate <= today.AddDays(60));
    return Results.Ok(new { salesToday, salesCount, lowStock, expirySoon });
});

/*
 PURPOSE:
 Completes one sale transaction and deducts the exact sold batches.
 REFERENCE:
 ClientOperationId provides idempotency so reconnect retries do not intentionally create duplicate invoices.
*/
app.MapPost("/api/sales", async (SaleRequest request, AppDbContext db) =>
{
    var existing = await db.Sales.FirstOrDefaultAsync(x => x.TenantId == request.TenantId && x.ClientOperationId == request.ClientOperationId);
    if (existing is not null)
        return Results.Ok(new { status = "already-synced", saleId = existing.Id, invoiceNo = existing.InvoiceNo });

    await using var transaction = await db.Database.BeginTransactionAsync();
    var lineEntities = new List<SaleLine>();
    decimal subtotal = 0m;

    foreach (var line in request.Lines)
    {
        var batch = await db.StockBatches.FirstOrDefaultAsync(x => x.Id == line.BatchId && x.TenantId == request.TenantId && x.BranchId == request.BranchId);
        if (batch is null)
            return Results.Conflict(new { message = $"Batch {line.BatchId} no longer exists.", code = "BATCH_NOT_FOUND" });
        if (batch.ExpiryDate.Date < DateTime.UtcNow.Date)
            return Results.Conflict(new { message = $"Batch {batch.BatchNo} is expired.", code = "BATCH_EXPIRED" });
        if (batch.Quantity < line.Quantity)
            return Results.Conflict(new { message = $"Not enough stock in batch {batch.BatchNo}. Server stock: {batch.Quantity}.", code = "STOCK_CONFLICT" });

        var product = await db.Products.FirstAsync(x => x.Id == batch.ProductId);
        var amount = line.Quantity * batch.SellingPrice;
        batch.Quantity -= line.Quantity;
        subtotal += amount;
        lineEntities.Add(new SaleLine
        {
            ProductId = product.Id,
            BatchId = batch.Id,
            ProductName = product.Name,
            BatchNo = batch.BatchNo,
            ExpiryDate = batch.ExpiryDate,
            Quantity = line.Quantity,
            UnitPrice = batch.SellingPrice,
            LineTotal = amount
        });
    }

    var sale = new Sale
    {
        TenantId = request.TenantId,
        BranchId = request.BranchId,
        ClientOperationId = request.ClientOperationId,
        InvoiceNo = $"INV-{DateTime.UtcNow:yyyyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}",
        Subtotal = subtotal,
        Discount = request.Discount,
        Total = Math.Max(0, subtotal - request.Discount),
        PaymentMethod = request.PaymentMethod,
        CustomerId = request.CustomerId,
        CreatedUtc = DateTime.UtcNow
    };

    db.Sales.Add(sale);
    await db.SaveChangesAsync();

    foreach (var line in lineEntities) line.SaleId = sale.Id;
    db.SaleLines.AddRange(lineEntities);
    await db.SaveChangesAsync();
    await transaction.CommitAsync();

    return Results.Ok(new { status = "synced", saleId = sale.Id, invoiceNo = sale.InvoiceNo, total = sale.Total });
});

/*
 PURPOSE:
 Returns tenant product data for management screens.
 REFERENCE:
 Keeping this endpoint separate from the sync snapshot makes later pagination/search easier.
*/
app.MapGet("/api/products", async (int tenantId, AppDbContext db) =>
    Results.Ok(await db.Products.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync()));

/*
 PURPOSE:
 Saves a new medicine master record from the Add Product screen.
 REFERENCE:
 Batch quantities are intentionally not stored in the Product table.
*/
app.MapPost("/api/products", async (ProductRequest request, AppDbContext db) =>
{
    var product = new Product
    {
        TenantId = request.TenantId,
        Name = request.Name,
        GenericName = request.GenericName,
        Strength = request.Strength,
        PackSize = request.PackSize,
        Category = request.Category,
        Brand = request.Brand,
        Barcode = request.Barcode,
        SellingPrice = request.SellingPrice,
        PurchasePrice = request.PurchasePrice,
        TrackBatchExpiry = request.TrackBatchExpiry,
        RequiresPrescription = request.RequiresPrescription,
        RxNormId = request.RxNormId ?? string.Empty,
        ImageUrl = request.ImageUrl ?? string.Empty,
        Manufacturer = request.Manufacturer ?? string.Empty,
        DosageForm = request.DosageForm ?? string.Empty,
        Notes = request.Notes ?? string.Empty
    };
    db.Products.Add(product);
    await db.SaveChangesAsync();
    return Results.Ok(product);
});

/*
 PURPOSE:
 Returns batch-wise inventory for stock and expiry screens.
 REFERENCE:
 Product names are projected together with batch information for easy rendering by the beginner-friendly client.
*/
app.MapGet("/api/stock", async (int tenantId, int branchId, AppDbContext db) =>
{
    var rows = await (from b in db.StockBatches
                      join p in db.Products on b.ProductId equals p.Id
                      where b.TenantId == tenantId && b.BranchId == branchId
                      orderby b.ExpiryDate
                      select new { b.Id, b.ProductId, productName = p.Name, b.BatchNo, b.ExpiryDate, b.Quantity, b.PurchasePrice, b.SellingPrice }).ToListAsync();
    return Results.Ok(rows);
});

/*
 PURPOSE:
 Posts a purchase/GRN line and adds stock to an existing or new batch.
 REFERENCE:
 This is the minimum working GRN path used by the purchase screen in this corrected build.
*/
app.MapPost("/api/purchases", async (PurchaseRequest request, AppDbContext db) =>
{
    foreach (var line in request.Lines)
    {
        var batch = await db.StockBatches.FirstOrDefaultAsync(x => x.TenantId == request.TenantId && x.BranchId == request.BranchId && x.ProductId == line.ProductId && x.BatchNo == line.BatchNo);
        if (batch is null)
        {
            batch = new StockBatch
            {
                TenantId = request.TenantId,
                BranchId = request.BranchId,
                ProductId = line.ProductId,
                BatchNo = line.BatchNo,
                ExpiryDate = line.ExpiryDate,
                Quantity = line.Quantity,
                PurchasePrice = line.PurchasePrice,
                SellingPrice = line.SellingPrice
            };
            db.StockBatches.Add(batch);
        }
        else
        {
            batch.Quantity += line.Quantity;
            batch.ExpiryDate = line.ExpiryDate;
            batch.PurchasePrice = line.PurchasePrice;
            batch.SellingPrice = line.SellingPrice;
        }
    }
    await db.SaveChangesAsync();
    return Results.Ok(new { status = "saved" });
});

/*
 PURPOSE:
 Returns customer records for the customer screen.
 REFERENCE:
 The demo stores commercial profile information only.
*/
app.MapGet("/api/customers", async (int tenantId, AppDbContext db) =>
    Results.Ok(await db.Customers.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync()));

/*
 PURPOSE:
 Returns supplier records for the supplier screen.
 REFERENCE:
 Suppliers are tenant-scoped and later can be linked to full purchase headers.
*/
app.MapGet("/api/suppliers", async (int tenantId, AppDbContext db) =>
    Results.Ok(await db.Suppliers.Where(x => x.TenantId == tenantId).OrderBy(x => x.Name).ToListAsync()));

/*
 PURPOSE:
 Returns SaaS platform tenants and plans for the platform administrator screen.
 REFERENCE:
 This endpoint is demo-only and must be protected by a real PlatformAdmin authorization policy in production.
*/
app.MapGet("/api/saas", async (AppDbContext db) =>
{
    var tenants = await db.Tenants.OrderBy(x => x.Name).ToListAsync();
    var plans = await db.SaaSPlans.OrderBy(x => x.MonthlyPrice).ToListAsync();
    return Results.Ok(new { tenants, plans });
});


/*
 PURPOSE:
 Updates an existing medicine master record.
 REFERENCE:
 This powers the Edit button on the Products screen.
*/
app.MapPut("/api/products/{id:int}", async (int id, ProductRequest request, AppDbContext db) =>
{
    var product = await db.Products.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == request.TenantId);
    if (product is null) return Results.NotFound(new { message = "Product not found." });
    product.Name = request.Name; product.GenericName = request.GenericName; product.Strength = request.Strength;
    product.PackSize = request.PackSize; product.Category = request.Category; product.Brand = request.Brand;
    product.Barcode = request.Barcode; product.SellingPrice = request.SellingPrice; product.PurchasePrice = request.PurchasePrice;
    product.TrackBatchExpiry = request.TrackBatchExpiry; product.RequiresPrescription = request.RequiresPrescription;
    product.RxNormId = request.RxNormId ?? string.Empty; product.ImageUrl = request.ImageUrl ?? string.Empty;
    product.Manufacturer = request.Manufacturer ?? string.Empty; product.DosageForm = request.DosageForm ?? string.Empty; product.Notes = request.Notes ?? string.Empty;
    await db.SaveChangesAsync();
    return Results.Ok(product);
});

/*
 PURPOSE:
 Creates or updates a customer record for the tenant.
 REFERENCE:
 Used by Add Customer and Edit Customer dialogs.
*/
app.MapPost("/api/customers", async (CustomerRequest request, AppDbContext db) =>
{
    var customer = MapCustomer(new Customer { TenantId = request.TenantId }, request);
    db.Customers.Add(customer); await db.SaveChangesAsync(); return Results.Ok(customer);
});
app.MapPut("/api/customers/{id:int}", async (int id, CustomerRequest request, AppDbContext db) =>
{
    var customer = await db.Customers.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == request.TenantId);
    if (customer is null) return Results.NotFound(new { message = "Customer not found." });
    MapCustomer(customer, request);
    await db.SaveChangesAsync(); return Results.Ok(customer);
});

/*
 PURPOSE:
 Creates or updates a supplier record for purchase receiving.
 REFERENCE:
 Used by Add Supplier and Edit Supplier dialogs.
*/
app.MapPost("/api/suppliers", async (SupplierRequest request, AppDbContext db) =>
{
    var supplier = new Supplier { TenantId = request.TenantId, Name = request.Name, ContactPerson = request.ContactPerson, Phone = request.Phone, Email = request.Email };
    db.Suppliers.Add(supplier); await db.SaveChangesAsync(); return Results.Ok(supplier);
});
app.MapPut("/api/suppliers/{id:int}", async (int id, SupplierRequest request, AppDbContext db) =>
{
    var supplier = await db.Suppliers.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == request.TenantId);
    if (supplier is null) return Results.NotFound(new { message = "Supplier not found." });
    supplier.Name = request.Name; supplier.ContactPerson = request.ContactPerson; supplier.Phone = request.Phone; supplier.Email = request.Email;
    await db.SaveChangesAsync(); return Results.Ok(supplier);
});

/*
 PURPOSE:
 Lists and creates tenant users from Settings > Users.
 REFERENCE:
 This keeps the Settings users tab functional. Production systems should replace the demo plain-text password storage with ASP.NET Core Identity.
*/
app.MapGet("/api/users", async (int tenantId, AppDbContext db) =>
{
    var users = await db.Users.Where(x => x.TenantId == tenantId).OrderBy(x => x.Username)
        .Select(x => new { x.Id, x.Username, x.DisplayName, x.Role, x.BranchId }).ToListAsync();
    return Results.Ok(users);
});
app.MapPost("/api/users", async (UserCreateRequest request, AppDbContext db) =>
{
    if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
        return Results.BadRequest(new { message = "Username and password are required." });
    var exists = await db.Users.AnyAsync(x => x.TenantId == request.TenantId && x.Username == request.Username);
    if (exists) return Results.Conflict(new { message = "That username already exists." });
    var branchOk = await db.Branches.AnyAsync(x => x.Id == request.BranchId && x.TenantId == request.TenantId);
    if (!branchOk) return Results.BadRequest(new { message = "Branch does not belong to this tenant." });
    var user = new AppUser { TenantId=request.TenantId, BranchId=request.BranchId, Username=request.Username.Trim(), PasswordHash=request.Password, DisplayName=request.DisplayName.Trim(), Role=string.IsNullOrWhiteSpace(request.Role)?"Cashier":request.Role.Trim() };
    db.Users.Add(user); await db.SaveChangesAsync();
    return Results.Ok(new { user.Id, user.Username, user.DisplayName, user.Role, user.BranchId });
});

/*
 PURPOSE:
 Returns recent invoices and sale lines for reports and receipt reprint.
 REFERENCE:
 The report screen uses this endpoint instead of decorative report cards only.
*/
app.MapGet("/api/reports/sales", async (int tenantId, int branchId, AppDbContext db) =>
{
    var sales = await db.Sales.Where(x => x.TenantId == tenantId && x.BranchId == branchId)
        .OrderByDescending(x => x.CreatedUtc).Take(200).ToListAsync();
    var saleIds = sales.Select(x => x.Id).ToList();
    var lines = await db.SaleLines.Where(x => saleIds.Contains(x.SaleId)).ToListAsync();
    return Results.Ok(new { sales, lines });
});

/*
 PURPOSE:
 Returns and persists tenant-level pharmacy settings.
 REFERENCE:
 The Settings Save button now writes to the central database rather than being visual only.
*/
app.MapGet("/api/settings", async (int tenantId, AppDbContext db) =>
{
    var value = await db.PharmacySettings.FirstOrDefaultAsync(x => x.TenantId == tenantId);
    if (value is null) return Results.NotFound(new { message = "Settings not found." });
    return Results.Ok(value);
});
app.MapPut("/api/settings", async (SettingsRequest request, AppDbContext db) =>
{
    var value = await db.PharmacySettings.FirstOrDefaultAsync(x => x.TenantId == request.TenantId);
    if (value is null) { value = new PharmacySetting { TenantId = request.TenantId }; db.PharmacySettings.Add(value); }
    value.PharmacyName = request.PharmacyName; value.Address = request.Address; value.Currency = request.Currency;
    value.InvoicePrefix = request.InvoicePrefix; value.ExpiryAlertDays = request.ExpiryAlertDays;
    var tenant = await db.Tenants.FirstOrDefaultAsync(x => x.Id == request.TenantId);
    if (tenant is not null && !string.IsNullOrWhiteSpace(request.PharmacyName)) tenant.Name = request.PharmacyName;
    await db.SaveChangesAsync(); return Results.Ok(value);
});

/*
 PURPOSE:
 Adjusts quantity for a single stock batch from the Stock View dialog.
 REFERENCE:
 This provides a controlled manual stock correction path for the demo.
*/
app.MapPut("/api/stock/{id:int}", async (int id, StockAdjustRequest request, AppDbContext db) =>
{
    var batch = await db.StockBatches.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == request.TenantId && x.BranchId == request.BranchId);
    if (batch is null) return Results.NotFound(new { message = "Stock batch not found." });
    batch.Quantity = Math.Max(0, request.Quantity);
    batch.ExpiryDate = request.ExpiryDate;
    batch.SellingPrice = request.SellingPrice;
    await db.SaveChangesAsync(); return Results.Ok(batch);
});



/*
 PURPOSE:
 Returns one patient's complete profile plus medicine purchase history reconstructed from completed invoices.
 REFERENCE:
 Sale.CustomerId links invoices to the customer while SaleLine preserves the exact medicine, batch, quantity and price sold.
*/
app.MapGet("/api/customers/{id:int}/history", async (int id, int tenantId, AppDbContext db) =>
{
    var customer = await db.Customers.FirstOrDefaultAsync(x => x.Id == id && x.TenantId == tenantId);
    if (customer is null) return Results.NotFound(new { message = "Customer not found." });
    var sales = await db.Sales.Where(x => x.TenantId == tenantId && x.CustomerId == id).OrderByDescending(x => x.CreatedUtc).ToListAsync();
    var ids = sales.Select(x => x.Id).ToList();
    var lines = await db.SaleLines.Where(x => ids.Contains(x.SaleId)).OrderByDescending(x => x.Id).ToListAsync();
    return Results.Ok(new { customer, sales, lines });
});

/*
 PURPOSE:
