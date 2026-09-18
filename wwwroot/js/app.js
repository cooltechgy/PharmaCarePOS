/*
 PURPOSE:
 Main beginner-friendly client application for PharmaCare POS.
 REFERENCE:
 The file is intentionally kept in one place so a new developer can trace navigation, rendering, offline storage and API calls without framework indirection.
*/

const appState = {
  session: JSON.parse(localStorage.getItem('pharmacare.session') || 'null'),
  view: 'dashboard',
  products: [],
  batches: [],
  customers: [],
  suppliers: [],
  cart: [],
  selectedProductId: null,
  selectedBatchId: null,
  paymentMethod: 'Cash',
  dashboard: { salesToday: 0, salesCount: 0, lowStock: 0, expirySoon: 0 },
  heldSales: JSON.parse(localStorage.getItem('pharmacare.heldSales') || '[]'),
  settings: null,
  settingsTab: 'general',
  settingsUsers: []
};

const app = document.getElementById('app');

/*
 PURPOSE:
 Starts the application and registers browser connectivity/service-worker hooks.
 REFERENCE:
 When connectivity returns the queued offline sales are synchronized automatically.
*/
async function boot() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/service-worker.js'); } catch (error) { console.warn('Service worker registration failed', error); }
  }
  window.addEventListener('online', async () => {
    toast('Internet restored. Synchronizing pending sales...', 'info');
    await syncPendingSales();
    await refreshSnapshot();
    render();
  });
  window.addEventListener('offline', () => { toast('Internet disconnected. POS continues in offline mode.', 'warning'); render(); });

  if (appState.session) {
    await loadOfflineSnapshot();
    if (navigator.onLine) {
      await refreshSnapshot();
      await loadDashboard();
      await syncPendingSales();
    }
  }
  render();
}

/*
 PURPOSE:
 Sends JSON to the ASP.NET Core API and returns parsed JSON.
 REFERENCE:
 A non-success HTTP status becomes an Error so UI functions can show a readable message.
*/
async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    let message = `Server error ${response.status}`;
    try { const body = await response.json(); message = body.message || message; } catch { }
    throw new Error(message);
  }
  return response.status === 204 ? null : await response.json();
}

/*
 PURPOSE:
 Escapes user/database text before inserting it into HTML templates.
 REFERENCE:
 This avoids accidental HTML injection in this small demo renderer.
*/
function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

/*
 PURPOSE:
 Formats a number as pharmacy currency for the demo UI.
 REFERENCE:
 Change the symbol and locale here to localize the whole interface.
*/
function money(value) { return `$${Number(value || 0).toFixed(2)}`; }

/*
 PURPOSE:
 Formats an ISO/date value as a compact readable date.
 REFERENCE:
 Expiry screens use the same formatter for consistent display.
*/
function fmtDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

/*
 PURPOSE:
 Shows a temporary status/error message in the lower-right corner.
 REFERENCE:
 This gives feedback for sync, sale, login and CRUD actions without blocking the cashier.
*/
function toast(message, type = 'success') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/*
 PURPOSE:
 Converts a screen name into the visual shell or login page.
 REFERENCE:
 Keeping one render entry point makes UI state predictable for beginners.
*/
function render() {
  if (!appState.session) {
    app.innerHTML = loginView();
    bindLogin();
    return;
  }
  app.innerHTML = shellView();
  bindShell();
}

/*
 PURPOSE:
 Renders the colorful login screen modeled after the reference design.
 REFERENCE:
 Demo credentials are displayed so the package can be tested immediately.
*/
function loginView() {
  return `
  <div class="login-page">
    <section class="login-art">
      <div class="brand-xl"><span>✚</span> PharmaCare POS</div>
      <h1>Manage Today.<br>For a Healthier Tomorrow.</h1>
      <ul>
        <li>Fast pharmacy billing</li><li>Batch & expiry tracking</li><li>Offline-first selling</li><li>Inventory control</li><li>Complete SaaS management</li>
      </ul>
      <div class="pills-art">💊 🧴 💉</div>
    </section>
    <section class="login-card-wrap">
      <form class="login-card" id="loginForm">
        <h2>Welcome Back!</h2><p>Sign in to your pharmacy workspace</p>
        <div class="field"><label>Tenant / Company Code</label><input id="tenantCode" value="pharmacare" autocomplete="organization" required></div>
        <div class="field"><label>Username</label><input id="username" value="admin" autocomplete="username" required></div>
        <div class="field"><label>Password</label><input id="password" type="password" value="Admin123!" autocomplete="current-password" required></div>
        <button class="btn-primary btn-lg" type="submit">Login</button>
        <div class="demo-box"><b>Pharmacy:</b> pharmacare / admin / Admin123!<br><b>SaaS platform:</b> platform / superadmin / SaaS123!</div>
      </form>
    </section>
  </div>`;
}

/*
 PURPOSE:
 Wires the login form to the server login endpoint.
 REFERENCE:
 Successful session context is kept in localStorage so the PWA can reopen while offline.
*/
function bindLogin() {
  document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = {
        tenantCode: document.getElementById('tenantCode').value.trim(),
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      };
      appState.session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) });
      localStorage.setItem('pharmacare.session', JSON.stringify(appState.session));
      await refreshSnapshot();
      await loadDashboard();
      appState.view = appState.session.role === 'PlatformAdmin' ? 'saas' : 'dashboard';
      render();
      toast('Login successful.');
    } catch (error) { toast(error.message || 'Login failed.', 'error'); }
  });
}

/*
 PURPOSE:
 Builds the shared left navigation/header and inserts the selected pharmacy screen.
 REFERENCE:
 The colors and density intentionally follow the screenshot reference more closely than the previous package.
*/
function shellView() {
  const nav = [
    ['dashboard','⌂','Dashboard'],['pos','🛒','POS (Sales)'],['products','💊','Products'],['purchase','▣','Purchase'],['stock','▤','Stock'],['expiry','⏰','Expiry Stock'],['customers','👥','Customers'],['suppliers','🚚','Suppliers'],['reports','📊','Reports']
  ];
  if (appState.session.role === 'PlatformAdmin') nav.unshift(['saas','☁','SaaS Admin']);
  nav.push(['settings','⚙','Settings']);
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand"><div class="logo-mark">✚</div><span>PharmaCare POS</span></div>
      <nav class="side-nav">${nav.map(n => `<a href="#" class="nav-item ${appState.view===n[0]?'active':''}" data-view="${n[0]}"><span class="nav-icon">${n[1]}</span><span class="nav-label">${n[2]}</span></a>`).join('')}</nav>
      <div class="side-footer">Smart Pharmacy Management<br>Offline-first SaaS POS</div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="top-search"><span class="search-icon">⌕</span><input id="globalSearch" placeholder="Search medicine, customer, invoice... (F2)"></div>
        <div class="branch-chip">📍 ${esc(appState.session.tenantName)}</div>
        <div class="online-chip ${navigator.onLine?'':'offline'}" id="networkChip">${navigator.onLine?'● Online':'● Offline'}</div>
        <div class="user-area"><div class="avatar">${esc(appState.session.displayName?.[0] || 'U')}</div><div class="user-chip">${esc(appState.session.displayName)}<br><small>${esc(appState.session.role)}</small></div><button class="btn-light btn-xs" id="logoutBtn">Logout</button></div>
      </header>
      <section class="content">${screenView()}</section>
    </main>
  </div>`;
}

/*
 PURPOSE:
 Chooses the HTML for the currently selected navigation screen.
 REFERENCE:
 Each screen renderer is kept separate below to make modification easy.
*/
function screenView() {
  switch (appState.view) {
    case 'pos': return posView();
    case 'products': return productsView();
    case 'purchase': return purchaseView();
    case 'stock': return stockView();
    case 'expiry': return expiryView();
    case 'customers': return customersView();
    case 'suppliers': return suppliersView();
    case 'reports': return reportsView();
    case 'settings': return settingsView();
    case 'saas': return saasView();
    default: return dashboardView();
  }
}

/*
 PURPOSE:
 Wires navigation, logout and per-screen buttons after the shell HTML is rendered.
 REFERENCE:
 Event binding is centralized so newly rendered DOM always receives the required handlers.
*/
function bindShell() {
  document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', async event => {
    event.preventDefault();
    appState.view = el.dataset.view;
    if (appState.view === 'dashboard' && navigator.onLine) await loadDashboard();
    render();
  }));
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
  bindCurrentScreen();
}

/*
 PURPOSE:
 Clears only login/session state and returns to the login screen.
 REFERENCE:
 Offline catalogue data is deliberately retained so the same pharmacy can work after re-login/reconnect.
*/
function logout() {
  localStorage.removeItem('pharmacare.session');
  appState.session = null;
  appState.cart = [];
  render();
}

/*
 PURPOSE:
 Loads the most recent server catalogue into memory and IndexedDB.
 REFERENCE:
 POS uses the IndexedDB copy when fetch fails or the browser reports offline.
*/
async function refreshSnapshot() {
  if (!appState.session || !navigator.onLine || appState.session.role === 'PlatformAdmin') return;
  try {
    const s = appState.session;
    const snapshot = await api(`/api/sync/snapshot?tenantId=${s.tenantId}&branchId=${s.branchId}`);
    appState.products = snapshot.products || [];
    appState.batches = snapshot.batches || [];
    appState.customers = snapshot.customers || [];
    appState.suppliers = snapshot.suppliers || [];
    await PharmaOffline.replaceAll('products', appState.products);
    await PharmaOffline.replaceAll('batches', appState.batches);
    await PharmaOffline.replaceAll('customers', appState.customers);
    await PharmaOffline.replaceAll('suppliers', appState.suppliers);
    await PharmaOffline.put('meta','lastSyncUtc',snapshot.serverUtc);
  } catch (error) {
    await loadOfflineSnapshot();
    toast('Server unavailable. Using saved offline catalogue.', 'warning');
  }
}
