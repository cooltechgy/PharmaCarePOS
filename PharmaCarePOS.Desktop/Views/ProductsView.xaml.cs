using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Views;

public partial class ProductsView : UserControl
{
    private readonly MainWindow _main;
    private List<ProductDto> _all = [];

    public ProductsView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        if (await App.Api.IsAvailableAsync(_main.Session))
            await App.Sync.RefreshSnapshotAsync(_main.Session);

        _all = await App.Local.GetProductsAsync();
        ApplyFilter();
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => ApplyFilter();

    private void ApplyFilter()
    {
        var q = SearchBox.Text.Trim().ToLowerInvariant();
        Grid.ItemsSource = _all.Where(x =>
            string.IsNullOrEmpty(q) ||
            x.Name.ToLowerInvariant().Contains(q) ||
            x.GenericName.ToLowerInvariant().Contains(q) ||
            x.Barcode.ToLowerInvariant().Contains(q)).ToList();
    }
}
