namespace PharmaCarePOS.Desktop.Views;

public partial class DashboardView : UserControl
{
    private readonly MainWindow _main;

    public DashboardView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            var d = await App.Api.GetDashboardAsync(_main.Session);
            SalesTodayText.Text = "$" + d.SalesToday.ToString("N2");
            SalesCountText.Text = d.SalesCount.ToString();
            LowStockText.Text = d.LowStock.ToString();
            ExpiryText.Text = d.ExpirySoon.ToString();

            await App.Sync.SyncPendingSalesAsync();
            await App.Sync.RefreshSnapshotAsync(_main.Session);
            SyncStatusText.Text = $"Online. Local pending sales: {await App.Local.PendingSaleCountAsync()}. Catalogue cache refreshed.";
        }
        catch
        {
            var products = await App.Local.GetProductsAsync();
            var batches = await App.Local.GetBatchesAsync();
            LowStockText.Text = batches.Count(x => x.Quantity <= 10).ToString();
            ExpiryText.Text = batches.Count(x => x.ExpiryDate <= DateTime.Today.AddDays(60)).ToString();
            SyncStatusText.Text = $"Offline mode. {products.Count} products and {batches.Count} batches are available locally. Pending sales: {await App.Local.PendingSaleCountAsync()}.";
        }
    }
}
