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
