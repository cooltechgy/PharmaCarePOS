namespace PharmaCarePOS.Desktop.Views;

public partial class ExpiryView : UserControl
{
    private readonly MainWindow _main;

    public ExpiryView(MainWindow main)
    {
        InitializeComponent();
        _main = main;
        Loaded += async (_, _) =>
        {
            if (await App.Api.IsAvailableAsync(_main.Session))
                await App.Sync.RefreshSnapshotAsync(_main.Session);

            Grid.ItemsSource = (await App.Local.GetBatchesAsync())
                .Where(x => x.ExpiryDate <= DateTime.Today.AddDays(90))
                .OrderBy(x => x.ExpiryDate)
                .ToList();
        };
    }
}
