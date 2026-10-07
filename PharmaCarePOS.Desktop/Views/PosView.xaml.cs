using System.Collections.ObjectModel;
using System.Windows.Input;
using System.Windows.Media;
using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Views;

public partial class PosView : UserControl
{
    private readonly MainWindow _main;
    private List<ProductDto> _allProducts = [];
    private List<BatchDto> _batches = [];
    private readonly ObservableCollection<ProductDto> _products = [];
    private readonly ObservableCollection<CartLine> _cart = [];

    public PosView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        ProductsGrid.ItemsSource = _products;
        CartGrid.ItemsSource = _cart;
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        var online = await App.Api.IsAvailableAsync(_main.Session);
        ModeText.Text = online ? "● Online" : "● Offline – local SQLite";
        ModeText.Foreground = online ? Brushes.SeaGreen : Brushes.DarkOrange;

        if (online)
        {
            await App.Sync.SyncPendingSalesAsync();
            await App.Sync.RefreshSnapshotAsync(_main.Session);
        }

        _allProducts = await App.Local.GetProductsAsync();
        _batches = await App.Local.GetBatchesAsync();
        FilterProducts();
    }

    private void FilterProducts()
    {
        var q = SearchBox.Text.Trim().ToLowerInvariant();
        _products.Clear();
        foreach (var p in _allProducts.Where(p =>
                     string.IsNullOrEmpty(q) ||
                     p.Name.ToLowerInvariant().Contains(q) ||
                     p.GenericName.ToLowerInvariant().Contains(q) ||
                     p.Barcode.ToLowerInvariant().Contains(q)))
            _products.Add(p);
    }

    /*
     PURPOSE:
     Uses FEFO against the locally cached batches so adding medicine works offline.
     REFERENCE:
     Expired or zero-stock batches are excluded before an item reaches the cart.
    */
    private void AddProduct(ProductDto product)
    {
        var batch = _batches
            .Where(x => x.ProductId == product.Id && x.Quantity > 0 && x.ExpiryDate.Date >= DateTime.Today)
            .OrderBy(x => x.ExpiryDate)
            .FirstOrDefault();

        if (batch is null)
        {
            MessageBox.Show("No valid in-stock batch is available for this medicine.", "Stock", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var existing = _cart.FirstOrDefault(x => x.BatchId == batch.Id);
        if (existing is not null)
        {
            if (existing.Quantity + 1 > existing.MaxQty)
            {
                MessageBox.Show("Not enough local stock.", "Stock", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
            existing.Quantity++;
            CartGrid.Items.Refresh();
        }
        else
        {
            _cart.Add(new CartLine
            {
                ProductId = product.Id,
                BatchId = batch.Id,
                ProductName = product.Name,
                BatchNo = batch.BatchNo,
                ExpiryDate = batch.ExpiryDate,
                Quantity = 1,
                MaxQty = batch.Quantity,
                UnitPrice = batch.SellingPrice
            });
        }

        UpdateTotals();
    }

    /*
     PURPOSE:
     Saves a completed sale to SQLite before any network call, then attempts synchronization.
     REFERENCE:
     ClientOperationId lets the API safely accept reconnect retries without intentional duplicate invoices.
    */
    private async Task CompleteSaleAsync(string paymentMethod)
    {
        if (_cart.Count == 0)
        {
            MessageBox.Show("Cart is empty.");
            return;
        }

        var sale = new SaleRequestDto
        {
            TenantId = _main.Session.TenantId,
            BranchId = _main.Session.BranchId,
            ClientOperationId = Guid.NewGuid().ToString(),
            Discount = 0,
            PaymentMethod = paymentMethod,
            Lines = _cart.Select(x => new SaleLineRequestDto { BatchId = x.BatchId, Quantity = x.Quantity }).ToList()
        };

        await App.Local.QueueSaleAsync(sale);
        _cart.Clear();
        UpdateTotals();

        var synced = await App.Sync.SyncPendingSalesAsync();
        await LoadAsync();

        MessageBox.Show(
            synced > 0 ? "Sale completed and synchronized." : "Sale saved offline and queued for synchronization.",
            "PharmaCare POS",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => FilterProducts();

    private void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter) return;
        var exact = _allProducts.FirstOrDefault(p => string.Equals(p.Barcode, SearchBox.Text.Trim(), StringComparison.OrdinalIgnoreCase));
        if (exact is not null)
        {
            AddProduct(exact);
            SearchBox.Clear();
        }
    }

    private void ProductsGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (ProductsGrid.SelectedItem is ProductDto p) AddProduct(p);
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadAsync();
    private void ClearCart_Click(object sender, RoutedEventArgs e) { _cart.Clear(); UpdateTotals(); }
    private async void PayHere_Click(object sender, RoutedEventArgs e) => await CompleteSaleAsync("Cash");
    private async void SendCashier_Click(object sender, RoutedEventArgs e) => await CompleteSaleAsync("PENDING::Cash");

    private void UpdateTotals()
    {
        var total = _cart.Sum(x => x.LineTotal);
        SubtotalText.Text = "$" + total.ToString("N2");
        TotalText.Text = "$" + total.ToString("N2");
    }
}
