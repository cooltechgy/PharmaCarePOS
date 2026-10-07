using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Services;

/*
 PURPOSE:
 Stores the desktop catalogue, batches, customers, cached login and pending sales in SQLite.
 REFERENCE:
 This is the offline data source when the API/internet connection is lost.
*/
public sealed class LocalStore
{
    private readonly string _dbPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PharmaCarePOS", "desktop-cache.db");

    private string ConnectionString => $"Data Source={_dbPath}";

    public async Task InitializeAsync()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dbPath)!);

        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();

        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
        CREATE TABLE IF NOT EXISTS auth_cache (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            session_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS batches (
            id INTEGER PRIMARY KEY,
            product_id INTEGER NOT NULL,
            expiry_utc TEXT NOT NULL,
            quantity REAL NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pending_sales (
            operation_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            created_utc TEXT NOT NULL,
            last_error TEXT NOT NULL DEFAULT ''
        );
        """;
        await cmd.ExecuteNonQueryAsync();
    }

    /*
     PURPOSE:
     Stores a successful online login so the same staff credentials can be verified during an outage.
     REFERENCE:
     The raw password is never stored in the SQLite cache.
    */
    public async Task SaveAuthAsync(string username, string password, SessionInfo session)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO auth_cache(username,password_hash,session_json)
            VALUES($u,$p,$s)
            ON CONFLICT(username) DO UPDATE SET password_hash=$p, session_json=$s;
            """;
        cmd.Parameters.AddWithValue("$u", username.Trim());
        cmd.Parameters.AddWithValue("$p", HashPassword(username, password));
        cmd.Parameters.AddWithValue("$s", JsonSerializer.Serialize(session));
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<SessionInfo?> TryOfflineLoginAsync(string username, string password)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT password_hash,session_json FROM auth_cache WHERE username=$u;";
        cmd.Parameters.AddWithValue("$u", username.Trim());

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;

        var expected = reader.GetString(0);
        if (!string.Equals(expected, HashPassword(username, password), StringComparison.Ordinal))
            return null;

        return JsonSerializer.Deserialize<SessionInfo>(reader.GetString(1));
    }

    public async Task SaveSnapshotAsync(SnapshotDto snapshot)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();

        foreach (var table in new[] { "products", "batches", "customers" })
        {
            await using var clear = db.CreateCommand();
            clear.Transaction = (SqliteTransaction)tx;
            clear.CommandText = $"DELETE FROM {table};";
            await clear.ExecuteNonQueryAsync();
        }

        foreach (var product in snapshot.Products)
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = "INSERT INTO products(id,json) VALUES($id,$json);";
            cmd.Parameters.AddWithValue("$id", product.Id);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(product));
            await cmd.ExecuteNonQueryAsync();
        }

        foreach (var batch in snapshot.Batches)
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = "INSERT INTO batches(id,product_id,expiry_utc,quantity,json) VALUES($id,$pid,$exp,$qty,$json);";
            cmd.Parameters.AddWithValue("$id", batch.Id);
            cmd.Parameters.AddWithValue("$pid", batch.ProductId);
            cmd.Parameters.AddWithValue("$exp", batch.ExpiryDate.ToUniversalTime().ToString("O"));
            cmd.Parameters.AddWithValue("$qty", batch.Quantity);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(batch));
            await cmd.ExecuteNonQueryAsync();
        }

        foreach (var customer in snapshot.Customers)
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = "INSERT INTO customers(id,json) VALUES($id,$json);";
            cmd.Parameters.AddWithValue("$id", customer.Id);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(customer));
            await cmd.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
    }

    public Task<List<ProductDto>> GetProductsAsync()
        => ReadJsonListAsync<ProductDto>("SELECT json FROM products ORDER BY id;");

    public Task<List<CustomerDto>> GetCustomersAsync()
        => ReadJsonListAsync<CustomerDto>("SELECT json FROM customers ORDER BY id;");

    public Task<List<BatchDto>> GetBatchesAsync()
        => ReadJsonListAsync<BatchDto>("SELECT json FROM batches ORDER BY expiry_utc;");

    /*
     PURPOSE:
     Commits an offline sale locally before any network call and immediately reduces cached batch stock.
     REFERENCE:
     The queue is later uploaded to POST /api/sales by SyncService.
    */
    public async Task QueueSaleAsync(SaleRequestDto sale)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();

        await using (var cmd = db.CreateCommand())
        {
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = """
                INSERT OR IGNORE INTO pending_sales(operation_id,payload_json,created_utc,last_error)
                VALUES($id,$json,$utc,'');
                """;
            cmd.Parameters.AddWithValue("$id", sale.ClientOperationId);
            cmd.Parameters.AddWithValue("$json", JsonSerializer.Serialize(sale));
            cmd.Parameters.AddWithValue("$utc", DateTime.UtcNow.ToString("O"));
            await cmd.ExecuteNonQueryAsync();
        }

        foreach (var line in sale.Lines)
        {
            BatchDto? batch = null;

            await using (var read = db.CreateCommand())
            {
                read.Transaction = (SqliteTransaction)tx;
                read.CommandText = "SELECT json FROM batches WHERE id=$id;";
                read.Parameters.AddWithValue("$id", line.BatchId);
                var json = await read.ExecuteScalarAsync() as string;
                if (!string.IsNullOrWhiteSpace(json))
                    batch = JsonSerializer.Deserialize<BatchDto>(json);
            }

            if (batch is null) continue;
            batch.Quantity = Math.Max(0, batch.Quantity - line.Quantity);

            await using var update = db.CreateCommand();
            update.Transaction = (SqliteTransaction)tx;
            update.CommandText = "UPDATE batches SET quantity=$qty,json=$json WHERE id=$id;";
            update.Parameters.AddWithValue("$qty", batch.Quantity);
            update.Parameters.AddWithValue("$json", JsonSerializer.Serialize(batch));
            update.Parameters.AddWithValue("$id", batch.Id);
            await update.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
    }

    public Task<List<SaleRequestDto>> GetPendingSalesAsync()
        => ReadJsonListAsync<SaleRequestDto>("SELECT payload_json FROM pending_sales ORDER BY created_utc;");

    public async Task MarkSaleSyncedAsync(string operationId)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "DELETE FROM pending_sales WHERE operation_id=$id;";
        cmd.Parameters.AddWithValue("$id", operationId);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task SaveSaleErrorAsync(string operationId, string error)
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "UPDATE pending_sales SET last_error=$e WHERE operation_id=$id;";
        cmd.Parameters.AddWithValue("$id", operationId);
        cmd.Parameters.AddWithValue("$e", error);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<int> PendingSaleCountAsync()
    {
        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM pending_sales;";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<List<T>> ReadJsonListAsync<T>(string sql)
    {
        var result = new List<T>();

        await using var db = new SqliteConnection(ConnectionString);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var value = JsonSerializer.Deserialize<T>(reader.GetString(0));
            if (value is not null) result.Add(value);
        }

        return result;
    }

    private static string HashPassword(string username, string password)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{username.Trim().ToLowerInvariant()}::{password}"));
        return Convert.ToHexString(bytes);
    }
}
