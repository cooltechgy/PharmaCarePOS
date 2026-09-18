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
