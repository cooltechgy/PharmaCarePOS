using Microsoft.EntityFrameworkCore;
using PharmaCarePOS.Models;

namespace PharmaCarePOS.Data;

/*
 PURPOSE:
 EF Core database context for the single runnable demo application.
 REFERENCE:
 SQL Server is used for the local database and can also be used for the hosted SaaS database.
*/
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<StockBatch> StockBatches => Set<StockBatch>();
    public DbSet<Sale> Sales => Set<Sale>();
    public DbSet<SaleLine> SaleLines => Set<SaleLine>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<SaaSPlan> SaaSPlans => Set<SaaSPlan>();
    public DbSet<PharmacySetting> PharmacySettings => Set<PharmacySetting>();

    /*
     PURPOSE:
     Adds database-level uniqueness rules used by offline synchronization.
     REFERENCE:
     The unique TenantId + ClientOperationId index is the final duplicate-sale guard.
    */
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Sale>()
            .HasIndex(x => new { x.TenantId, x.ClientOperationId })
            .IsUnique();

        modelBuilder.Entity<Tenant>()
            .HasIndex(x => x.Code)
            .IsUnique();

        modelBuilder.Entity<PharmacySetting>()
            .HasIndex(x => x.TenantId)
            .IsUnique();

        modelBuilder.Entity<Product>()
            .HasIndex(x => new { x.TenantId, x.RxNormId });
    }
}
