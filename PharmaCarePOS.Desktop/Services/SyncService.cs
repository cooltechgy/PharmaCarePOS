using PharmaCarePOS.Desktop.Models;

namespace PharmaCarePOS.Desktop.Services;

/*
 PURPOSE:
 Synchronizes cached catalogue data and queued offline sales.
 REFERENCE:
 ClientOperationId on the existing sales API makes reconnect retries idempotent.
*/
public sealed class SyncService(ApiService api, LocalStore local)
{
    public async Task<bool> RefreshSnapshotAsync(SessionInfo session)
    {
        try
        {
            var snapshot = await api.GetSnapshotAsync(session);
            await local.SaveSnapshotAsync(snapshot);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<int> SyncPendingSalesAsync()
    {
        var synced = 0;

        foreach (var sale in await local.GetPendingSalesAsync())
        {
            try
            {
                await api.SubmitSaleAsync(sale);
                await local.MarkSaleSyncedAsync(sale.ClientOperationId);
                synced++;
            }
            catch (Exception ex)
            {
                await local.SaveSaleErrorAsync(sale.ClientOperationId, ex.Message);
            }
        }

        return synced;
    }
}
