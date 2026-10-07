using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Views;

public partial class CashierView : UserControl
{
    private readonly MainWindow _main;
    private PendingCashierDto? _selected;

    public CashierView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        Loaded += async (_, _) => await LoadAsync();
    }

    private async Task LoadAsync()
    {
        try
        {
            Grid.ItemsSource = await App.Api.GetPendingCashierAsync(_main.Session);
        }
        catch
        {
            Grid.ItemsSource = Array.Empty<PendingCashierDto>();
            MessageBox.Show("Cashier completion requires an online server connection.", "Offline");
        }
    }

    private void Grid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = Grid.SelectedItem as PendingCashierDto;
        CustomerText.Text = _selected?.CustomerName ?? "";
        InvoiceText.Text = _selected?.InvoiceNo ?? "";
        TotalText.Text = _selected is null ? "$0.00" : "$" + _selected.Total.ToString("N2");
    }

    private async void Confirm_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var method = (MethodBox.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "Cash";

        try
        {
            await App.Api.CompleteCashierAsync(_main.Session, _selected.Id, method);
            await LoadAsync();
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Payment Error");
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await LoadAsync();
}
