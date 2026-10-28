using PharmaCarePOSBlazor.Models;

namespace PharmaCarePOSBlazor.Services;

public sealed class SessionState
{
    public SessionInfo? Current { get; private set; }
    public bool IsAuthenticated => Current is not null;

    public void Set(SessionInfo session) => Current = session;
    public void Clear() => Current = null;
}
