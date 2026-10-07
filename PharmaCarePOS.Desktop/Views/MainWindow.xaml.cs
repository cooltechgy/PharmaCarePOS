using System.Windows.Media;
using System.Windows.Threading;
using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Views;

public partial class MainWindow : Window
{
    public SessionInfo Session { get; }
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromSeconds(20) };
    private bool _offline;

    public MainWindow(SessionInfo session, bool offline)
    {
        InitializeComponent();
        Session = session;
        _offline = offline;
        UserText.Text = $"{session.DisplayName} • {session.Role}";
        UpdateConnectionLabel();
        MainContent.Content = new DashboardView(this);
        _timer.Tick += async (_, _) => await PollConnectionAsync();
        _timer.Start();
    }

    /*
     PURPOSE:
     Performs native WPF sidebar navigation without loading any webpage.
     REFERENCE:
     Each module is a WPF UserControl hosted in this window.
    */
    private void Nav_Click(object sender, RoutedEventArgs e)
    {
        var tag = (sender as Button)?.Tag?.ToString();
        MainContent.Content = tag switch
        {
            "Dashboard" => new DashboardView(this),
            "POS" => new PosView(this),
            "Cashier" => new CashierView(this),
            "Products" => new ProductsView(this),
            "Stock" => new StockView(this),
            "Customers" => new CustomersView(this),
            "Expiry" => new ExpiryView(this),
            "Purchase" => new SimplePageView("Purchase", "Purchase receiving is online-only in the first desktop build."),
            "Reports" => new SimplePageView("Reports", "Desktop report viewer is planned next. Server reports remain available through the API."),
            "Users" => new SimplePageView("Users & Roles", "User and role administration requires the online API."),
            "Settings" => new SimplePageView("Settings", "API: http://localhost:5001 • Offline cache: SQLite"),
            _ => new DashboardView(this)
        };
    }

    private async Task PollConnectionAsync()
    {
        var online = await App.Api.IsAvailableAsync(Session);
        _offline = !online;
        if (online)
        {
            await App.Sync.SyncPendingSalesAsync();
            await App.Sync.RefreshSnapshotAsync(Session);
        }
        UpdateConnectionLabel();
    }

    private void Logout_Click(object sender, RoutedEventArgs e)
    {
        _timer.Stop();
        var login = new LoginWindow();
        Application.Current.MainWindow = login;
        login.Show();
        Close();
    }

    private void UpdateConnectionLabel()
    {
        _ = Dispatcher.InvokeAsync(async () =>
        {
            var pending = await App.Local.PendingSaleCountAsync();
            ConnectionText.Text = _offline ? $"● Offline • {pending} queued" : $"● Online • {pending} queued";
        });
    }
}

public sealed class SimplePageView : UserControl
{
    public SimplePageView(string title, string message)
    {
        Content = new Border
        {
            Background = Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(215, 230, 241)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(25),
            Child = new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = title, FontSize = 28, FontWeight = FontWeights.Bold },
                    new TextBlock { Text = message, Margin = new Thickness(0,10,0,0), Foreground = Brushes.SlateGray, FontSize = 15 }
                }
            }
        };
    }
}
