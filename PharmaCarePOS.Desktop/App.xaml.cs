using PharmaCarePOS.Desktop.Services;
using PharmaCarePOS.Desktop.Views;

namespace PharmaCarePOS.Desktop;

/*
 PURPOSE:
 Starts the native WPF desktop client and creates shared API/offline services.
 REFERENCE:
 Desktop uses the existing ASP.NET Core API and SQLite when the API is unavailable.
*/
public partial class App : Application
{
    public static ApiService Api { get; private set; } = null!;
    public static LocalStore Local { get; private set; } = null!;
    public static SyncService Sync { get; private set; } = null!;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Local = new LocalStore();
        await Local.InitializeAsync();
        Api = new ApiService("http://localhost:5001");
        Sync = new SyncService(Api, Local);
        new LoginWindow().Show();
    }
}
