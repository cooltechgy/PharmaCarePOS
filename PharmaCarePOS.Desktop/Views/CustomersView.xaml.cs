namespace PharmaCarePOS.Desktop.Views;

public partial class CustomersView : UserControl
{
    private readonly MainWindow _main;

    public CustomersView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        Loaded += async (_, _) =>
        {
            if (await App.Api.IsAvailableAsync(_main.Session))
                await App.Sync.RefreshSnapshotAsync(_main.Session);
            Grid.ItemsSource = await App.Local.GetCustomersAsync();
        };
    }
}
