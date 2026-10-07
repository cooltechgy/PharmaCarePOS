using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Views;

public partial class LoginWindow : Window
{
    public LoginWindow() => InitializeComponent();

    /*
     PURPOSE:
     Tries online API login first and falls back to the encrypted/hash-protected local login cache.
     REFERENCE:
     Staff can reopen the desktop POS during an outage after at least one successful online login.
    */
    private async void LoginButton_Click(object sender, RoutedEventArgs e)
    {
        LoginButton.IsEnabled = false;
        StatusText.Text = "Signing in...";

        var username = UsernameBox.Text.Trim();
        var password = PasswordBox.Password;

        try
        {
            SessionInfo session;
            var offline = false;

            try
            {
                session = await App.Api.LoginAsync(username, password);
                await App.Local.SaveAuthAsync(username, password, session);
                await App.Sync.RefreshSnapshotAsync(session);
                await App.Sync.SyncPendingSalesAsync();
            }
            catch
            {
                session = await App.Local.TryOfflineLoginAsync(username, password)
                          ?? throw new InvalidOperationException("Server unavailable and no matching offline login is cached.");
                offline = true;
            }

            var main = new MainWindow(session, offline);
            Application.Current.MainWindow = main;
            main.Show();
            Close();
        }
        catch (Exception ex)
        {
            StatusText.Text = ex.Message;
            LoginButton.IsEnabled = true;
        }
    }
}
