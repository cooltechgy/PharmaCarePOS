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
/*
 PURPOSE:
 Reads pharmacy catalogue data from browser IndexedDB.
 REFERENCE:
 Called at startup and when an online snapshot cannot be obtained.
*/
async function loadOfflineSnapshot() {
  appState.products = await PharmaOffline.all('products');
  appState.batches = await PharmaOffline.all('batches');
  appState.customers = await PharmaOffline.all('customers');
  appState.suppliers = await PharmaOffline.all('suppliers');
}

/*
 PURPOSE:
 Loads online dashboard metrics.
 REFERENCE:
 Offline dashboard keeps the last in-memory values; sales themselves still continue offline.
*/
async function loadDashboard() {
  if (!appState.session || !navigator.onLine || appState.session.role === 'PlatformAdmin') return;
  try {
    const s = appState.session;
    appState.dashboard = await api(`/api/dashboard?tenantId=${s.tenantId}&branchId=${s.branchId}`);
  } catch { }
}

/*
 PURPOSE:
 Renders the colorful home dashboard with the same card/alert composition as the reference image.
 REFERENCE:
 Expiry list is built from currently cached batch data so it remains visible offline.
*/
function dashboardView() {
  const d = appState.dashboard;
  const expiring = [...appState.batches].sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate)).slice(0,5);
  return `
    <div class="page-header"><div><h1>Good Morning, ${esc(appState.session.displayName)} 👋</h1><p>Let's keep people healthy today.</p></div><div class="header-actions"><button class="btn-success" data-go="pos">+ New Sale</button><button class="btn-primary" data-go="purchase">New Purchase</button><button class="btn-purple" data-go="products">+ Add Product</button></div></div>
    ${navigator.onLine?'':'<div class="offline-banner">⚡ Offline mode active — cached catalogue and sales queue are available.</div>'}
    <div class="cards">
      <div class="metric green"><div class="label">🛒 Today's Sales</div><div class="value">${money(d.salesToday)}</div><div class="small">Live server total when online</div></div>
      <div class="metric blue"><div class="label">🧾 Sales Count</div><div class="value">${d.salesCount}</div><div class="small">Today's completed invoices</div></div>
      <div class="metric orange"><div class="label">⚠ Low Stock</div><div class="value">${d.lowStock || appState.batches.filter(b=>b.quantity<=10).length}</div><div class="small">Batches at 10 units or less</div></div>
      <div class="metric red"><div class="label">⏰ Expiring Soon</div><div class="value">${d.expirySoon || expiring.filter(b=>daysLeft(b.expiryDate)<=60).length}</div><div class="small">Within 60 days</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><span>Sales Overview</span><span class="badge blue">This Week</span></div><div class="panel-body"><div class="chart-bars">${[36,52,43,66,61,84,96].map((h,i)=>`<div class="bar" style="height:${h}%"><span>${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</span></div>`).join('')}</div></div></div>
      <div class="panel"><div class="panel-head"><span>Expiry Alerts</span><button class="btn-light btn-xs" data-go="expiry">View All</button></div><div class="panel-body"><div class="expiry-list">${expiring.map(b=>{const p=appState.products.find(x=>x.id===b.productId);return `<div class="expiry-item"><b>${esc(p?.name||'Product')}</b><span>${esc(b.batchNo)}</span><span class="${daysLeft(b.expiryDate)<=30?'danger-text':'warn-text'}">${fmtDate(b.expiryDate)}</span></div>`}).join('') || '<div class="empty">No cached batches yet.</div>'}</div></div></div>
    </div>`;
}

/*
 PURPOSE:
 Returns remaining whole days until an expiry date.
 REFERENCE:
 Negative numbers represent already expired batches.
*/
function daysLeft(dateValue) { return Math.ceil((new Date(dateValue).setHours(0,0,0,0) - new Date().setHours(0,0,0,0))/86400000); }

/*
 PURPOSE:
 Renders the batch-aware POS sales screen.
 REFERENCE:
 Product selection, batch selection, cart, payment and completion are all functional in this build.
*/
function posView() {
  const selected = appState.products.find(p=>p.id===appState.selectedProductId);
  const productBatches = appState.batches.filter(b=>b.productId===appState.selectedProductId && b.quantity>0 && daysLeft(b.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate));
  const subtotal = appState.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  return `
    <div class="page-header"><div><h1>POS Sales</h1><p>Fast billing with batch & expiry control</p></div><span class="sync-pill">${navigator.onLine?'🟢 Online sync ready':'🟠 Offline queue ready'}</span></div>
    ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode: invoices are saved locally first and synchronized when internet returns.</div>'}
    <div class="pos-grid">
      <div class="panel product-search-panel">
        <div class="panel-head"><span>Find Medicine</span><span class="badge blue">F2 Search</span></div>
        <div class="pos-search"><input id="posSearch" placeholder="Scan barcode or search medicine..."><button class="btn-primary" id="posSearchBtn">Search</button></div>
        <div class="product-list" id="productList">${appState.products.map(p=>`<div class="product-row ${p.id===appState.selectedProductId?'selected':''}" data-product-id="${p.id}"><div><div class="product-name">${esc(p.name)}</div><small class="muted">${esc(p.genericName)} • ${esc(p.packSize)}</small></div><div>${esc(p.strength)}</div><div>${money(p.sellingPrice)}</div><div>${stockForProduct(p.id)}</div></div>`).join('')}</div>
        ${selected?`<div class="medicine-card"><div class="medicine-icon">💊</div><div><b>${esc(selected.name)}</b><div class="muted">${esc(selected.category)} • ${esc(selected.brand)}</div><div class="good-text">${stockForProduct(selected.id)} in stock</div></div></div><div class="batch-box"><b>Select Batch (FEFO)</b><p class="muted">Earliest valid expiry appears first.</p><div class="batch-buttons">${productBatches.map(b=>`<button class="batch-btn ${b.id===appState.selectedBatchId?'active':''}" data-batch-id="${b.id}">${esc(b.batchNo)} • ${fmtDate(b.expiryDate)} • Qty ${b.quantity}</button>`).join('') || '<span class="danger-text">No valid stock batch.</span>'}</div><div style="margin-top:10px"><button class="btn-success" id="addToCartBtn" ${appState.selectedBatchId?'':'disabled'}>+ Add Selected Batch</button></div></div>`:''}
      </div>
      <div class="panel">
        <div class="panel-head"><span>Cart (${appState.cart.length} lines)</span><button class="btn-danger btn-xs" id="clearCartBtn">Clear</button></div>
        <div class="panel-body">
          <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>${appState.cart.map((l,i)=>`<tr><td>${i+1}</td><td><b>${esc(l.productName)}</b></td><td>${esc(l.batchNo)}</td><td class="${daysLeft(l.expiryDate)<=30?'danger-text':''}">${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:72px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td><button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Scan or select a medicine to begin.</td></tr>'}</tbody></table></div>
          <div class="cart-summary"><div class="sum-box">Subtotal<strong>${money(subtotal)}</strong></div><div class="sum-box">Discount<strong>${money(0)}</strong></div><div class="sum-box total-box">Total<strong>${money(subtotal)}</strong></div></div>
          <div style="margin-top:14px"><b>Payment Method</b><div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div></div>
          <div class="checkout-actions"><button class="btn-light" id="holdSaleBtn">Hold (F7)</button><button class="btn-light" id="printBtn">Print (F8)</button><button class="btn-success btn-lg" id="completeSaleBtn" ${appState.cart.length?'':'disabled'}>Complete Sale (F9)</button></div>
        </div>
      </div>
    </div>`;
}

/*
 PURPOSE:
 Calculates cached branch stock for one product.
 REFERENCE:
 Used by the offline POS search list and product table.
*/
function stockForProduct(productId) { return appState.batches.filter(b=>b.productId===productId).reduce((s,b)=>s+Number(b.quantity||0),0); }

/*
 PURPOSE:
 Renders medicine master management with a working Add Product modal.
 REFERENCE:
 Stock is calculated from batches instead of being duplicated on the product record.
*/
function productsView() {
  return `<div class="page-header"><div><h1>Products / Medicines</h1><p>Medicine master and pricing</p></div><button class="btn-primary" id="addProductBtn">+ Add Product</button></div>
  <div class="panel"><div class="panel-body"><div class="toolbar"><input class="grow" id="productFilter" placeholder="Search product..."><select style="width:170px"><option>All Categories</option></select><select style="width:150px"><option>Active</option></select></div>
  <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Product Name</th><th>Strength</th><th>Pack Size</th><th>Brand</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody id="productTableBody">${productRows(appState.products)}</tbody></table></div></div></div>`;
}

/*
 PURPOSE:
 Produces product table rows and is reused by the product search filter.
 REFERENCE:
 Separating row generation keeps filter logic simple for a new developer.
*/
function productRows(products) {
  return products.map((p,i)=>`<tr><td>${i+1}</td><td><b>${esc(p.name)}</b><br><small class="muted">${esc(p.genericName)}</small></td><td>${esc(p.strength)}</td><td>${esc(p.packSize)}</td><td>${esc(p.brand)}</td><td>${money(p.sellingPrice)}</td><td><span class="badge ${stockForProduct(p.id)<=10?'orange':'green'}">${stockForProduct(p.id)}</span></td><td><button class="btn-primary btn-xs" data-edit-product="${p.id}">Edit</button></td></tr>`).join('');
}

/*
 PURPOSE:
 Renders the working purchase/GRN form.
 REFERENCE:
 Saving a purchase updates central batch stock, then refreshes the offline snapshot.
*/
function purchaseView() {
  const firstProduct = appState.products[0];
  return `<div class="page-header"><div><h1>Purchase Entry</h1><p>Goods received with batch & expiry</p></div><button class="btn-primary" id="newPurchaseBtn">+ New Purchase</button></div>
  <div class="panel"><div class="tabs"><button class="tab active">Basic Info</button><button class="tab">Notes</button></div><div class="panel-body">
  <form id="purchaseForm"><div class="form-grid"><div class="field"><label>Supplier</label><select id="purchaseSupplier">${appState.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Invoice No.</label><input id="purchaseInvoice" value="SUP-${Date.now().toString().slice(-6)}"></div><div class="field"><label>Product</label><select id="purchaseProduct">${appState.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div class="field"><label>Batch No.</label><input id="purchaseBatch" value="NEW${new Date().getMonth()+1}${new Date().getDate()}"></div><div class="field"><label>Expiry Date</label><input id="purchaseExpiry" type="date" value="${new Date(Date.now()+31536000000).toISOString().slice(0,10)}"></div><div class="field"><label>Quantity</label><input id="purchaseQty" type="number" min="1" value="100"></div><div class="field"><label>Purchase Price</label><input id="purchaseCost" type="number" step="0.01" value="${firstProduct?.purchasePrice||1}"></div><div class="field"><label>Selling Price</label><input id="purchaseSell" type="number" step="0.01" value="${firstProduct?.sellingPrice||2}"></div></div><div class="checkout-actions"><button type="button" class="btn-light" id="cancelPurchaseBtn">Cancel</button><button type="submit" class="btn-success btn-lg">Save Purchase (F9)</button></div></form></div></div>`;
}

/*
 PURPOSE:
 Renders current inventory batch by batch.
 REFERENCE:
 This matches the reference image where batch number and expiry are primary inventory columns.
*/
function stockView() {
  const rows = [...appState.batches].sort((a,b)=>String(a.batchNo).localeCompare(String(b.batchNo)));
  return `<div class="page-header"><div><h1>Stock / Inventory</h1><p>Batch-wise stock control</p></div><button class="btn-primary" id="syncNowBtn">↻ Sync Now</button></div><div class="panel"><div class="panel-body"><div class="toolbar"><input class="grow" id="stockSearch" placeholder="Search product or batch..."><select id="stockStatus" style="width:170px"><option value="all">All Status</option><option value="low">Low Stock</option><option value="expiry">Expiring Soon</option><option value="expired">Expired</option></select><button class="btn-primary" id="exportStockBtn">Export CSV</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch No.</th><th>Expiry Date</th><th>Stock</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(b=>{const p=appState.products.find(x=>x.id===b.productId);const dl=daysLeft(b.expiryDate);const status=dl<0?['Expired','red']:dl<=60?['Expiring Soon','orange']:b.quantity<=10?['Low Stock','orange']:['In Stock','green'];return `<tr><td><b>${esc(p?.name||'Product')}</b></td><td>${esc(b.batchNo)}</td><td class="${dl<=30?'danger-text':''}">${fmtDate(b.expiryDate)}</td><td>${b.quantity}</td><td><span class="badge ${status[1]}">${status[0]}</span></td><td><button class="btn-primary btn-xs" data-stock-view="${b.id}">View</button></td></tr>`}).join('')}</tbody></table></div></div></div>`;
}

/*
 PURPOSE:
 Renders near-expiry and expired batch report with traffic-light status colors.
 REFERENCE:
 Days-left calculation is based on local calendar date for easy cashier interpretation.
*/
function expiryView() {
  const rows=[...appState.batches].sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate));
  return `<div class="page-header"><div><h1>Expiry / Near Expiry Report</h1><p>Take action before stock becomes dead stock</p></div><button class="btn-primary" id="exportExpiryBtn">Export CSV</button></div><div class="panel"><div class="panel-body"><div class="toolbar"><select id="expiryFilter" style="width:180px"><option value="90">Next 3 Months</option><option value="180">Next 6 Months</option><option value="all">All</option></select></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch No.</th><th>Expiry Date</th><th>Days Left</th><th>Stock</th><th>Status</th></tr></thead><tbody>${rows.map(b=>{const p=appState.products.find(x=>x.id===b.productId);const dl=daysLeft(b.expiryDate);return `<tr><td><b>${esc(p?.name||'')}</b></td><td>${esc(b.batchNo)}</td><td class="${dl<=30?'danger-text':dl<=60?'warn-text':'good-text'}">${fmtDate(b.expiryDate)}</td><td>${dl}</td><td>${b.quantity}</td><td><span class="badge ${dl<0?'red':dl<=60?'orange':'green'}">${dl<0?'Expired':dl<=60?'Expiring Soon':'OK'}</span></td></tr>`}).join('')}</tbody></table></div></div></div>`;
}

/*
 PURPOSE:
 Renders customer records.
 REFERENCE:
 This screen mirrors the compact list style used in the reference pharmacy UI.
*/
function customersView() { return peopleTable('Customers','+ Add Customer',appState.customers,'customer'); }

/*
 PURPOSE:
 Renders supplier records.
 REFERENCE:
 Supplier contacts are used by the purchase/GRN workflow.
*/
function suppliersView() { return peopleTable('Suppliers','+ Add Supplier',appState.suppliers,'supplier'); }

/*
 PURPOSE:
 Produces the shared customer/supplier table layout.
 REFERENCE:
 A shared function reduces duplicated beginner code without hiding business behavior.
*/
function peopleTable(title,buttonLabel,items,type) {
  return `<div class="page-header"><div><h1>${title}</h1><p>${type==='supplier'?'Purchase source directory':'Customer purchase directory'}</p></div><button class="btn-success" id="addPersonBtn">${buttonLabel}</button></div><div class="panel"><div class="panel-body"><div class="toolbar"><input class="grow" id="peopleSearch" placeholder="Search ${type}..."></div><div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Name</th>${type==='supplier'?'<th>Contact Person</th>':''}<th>Phone</th><th>Email</th><th>Action</th></tr></thead><tbody>${items.map((x,i)=>`<tr><td>${i+1}</td><td><b>${esc(x.name)}</b></td>${type==='supplier'?`<td>${esc(x.contactPerson)}</td>`:''}<td>${esc(x.phone)}</td><td>${esc(x.email)}</td><td><button class="btn-primary btn-xs" data-edit-person="${x.id}">Edit</button></td></tr>`).join('')}</tbody></table></div></div></div>`;
}

/*
 PURPOSE:
 Renders the colorful reports menu shown in the reference design.
 REFERENCE:
 Report tiles are navigation affordances; detailed report APIs can be added behind the same UI later.
*/
function reportsView() {
  return `<div class="page-header"><div><h1>Reports</h1><p>Sales, purchase, stock and profitability</p></div></div><div class="report-cards"><div class="report-card green" data-report="sales"><span>📈 Sales Report</span><small>Daily, monthly, custom</small></div><div class="report-card blue" data-report="purchase"><span>🛒 Purchase Report</span><small>Supplier purchases</small></div><div class="report-card orange" data-report="stock"><span>📦 Stock Report</span><small>Current stock & valuation</small></div><div class="report-card red" data-report="expiry"><span>📅 Expiry Report</span><small>Near expiry / expired</small></div><div class="report-card purple" data-report="profit"><span>◔ Profit & Loss</span><small>Product-wise profitability</small></div><div class="report-card teal" data-report="customer"><span>👥 Customer Report</span><small>Purchase history</small></div></div>`;
}

/*
 PURPOSE:
 Renders tenant-level settings used by the visual reference.
 REFERENCE:
 This demo stores settings visually only; production should persist these per tenant in the server database.
*/
function settingsView() {
  const tab = appState.settingsTab || 'general';
  const active = name => tab===name ? ' active' : '';
  let body = '';

  if (tab === 'general') {
    body = `<div class="form-grid"><div class="field"><label>Pharmacy Name</label><input id="setName" value="${esc(appState.settings?.pharmacyName || appState.session.tenantName)}"></div><div class="field"><label>Currency</label><select id="setCurrency"><option value="USD" ${appState.settings?.currency==='USD'?'selected':''}>USD ($)</option><option value="GYD" ${appState.settings?.currency==='GYD'?'selected':''}>GYD ($)</option></select></div><div class="field full"><label>Address</label><input id="setAddress" value="${esc(appState.settings?.address || 'Main Branch')}"></div><div class="field"><label>Expiry Alert Days</label><input id="setExpiryDays" type="number" min="1" value="${appState.settings?.expiryAlertDays || 60}"></div></div><div class="checkout-actions"><button class="btn-success" id="saveGeneralSettingsBtn">Save General Settings</button></div>`;
  } else if (tab === 'invoice') {
    body = `<div class="form-grid"><div class="field"><label>Invoice Prefix</label><input id="setPrefix" value="${esc(appState.settings?.invoicePrefix || 'INV')}"></div><div class="field"><label>Currency</label><select id="invoiceCurrency"><option value="USD" ${appState.settings?.currency==='USD'?'selected':''}>USD ($)</option><option value="GYD" ${appState.settings?.currency==='GYD'?'selected':''}>GYD ($)</option></select></div><div class="field full"><label>Invoice Preview</label><div class="section-note">${esc(appState.settings?.invoicePrefix || 'INV')}-000001 &nbsp; • &nbsp; ${esc(appState.settings?.pharmacyName || appState.session.tenantName)}</div></div></div><div class="checkout-actions"><button class="btn-success" id="saveInvoiceSettingsBtn">Save Invoice Settings</button><button class="btn-light" id="previewInvoiceBtn">Preview Invoice</button></div>`;
  } else if (tab === 'users') {
    body = `<div class="toolbar"><button class="btn-primary" id="loadSettingsUsersBtn">Refresh Users</button><button class="btn-success" id="addSettingsUserBtn">+ Add User</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>User</th><th>Display Name</th><th>Role</th><th>Branch</th></tr></thead><tbody>${(appState.settingsUsers||[]).map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.displayName)}</td><td>${esc(u.role)}</td><td>${u.branchId}</td></tr>`).join('') || '<tr><td colspan="4">Click Refresh Users to load users.</td></tr>'}</tbody></table></div>`;
  } else if (tab === 'backup') {
    body = `<div class="section-note"><b>Local backup:</b> downloads the current cached catalogue, batches, customers, suppliers and settings as JSON. This is useful for emergency export but is not a replacement for SQL Server backups.</div><div class="checkout-actions"><button class="btn-primary" id="downloadBackupBtn">Download JSON Backup</button><button class="btn-light" id="downloadProductsCsvBtn">Export Products CSV</button></div>`;
  } else {
    body = `<div class="form-grid"><div class="field"><label>Connection</label><input value="${navigator.onLine?'Online':'Offline'}" disabled></div><div class="field"><label>Pending Offline Sales</label><input id="pendingSalesCount" value="Checking..." disabled></div></div><div class="checkout-actions"><button class="btn-primary" id="systemSyncBtn">Sync Now</button><button class="btn-light" id="clearOfflineCacheBtn">Refresh Local Cache</button></div>`;
  }

  return `<div class="page-header"><div><h1>Settings</h1><p>Pharmacy, invoice, users, backup and system options</p></div></div><div class="panel"><div class="tabs"><button class="tab${active('general')}" data-settings-tab="general">General</button><button class="tab${active('invoice')}" data-settings-tab="invoice">Invoice</button><button class="tab${active('users')}" data-settings-tab="users">Users</button><button class="tab${active('backup')}" data-settings-tab="backup">Backup</button><button class="tab${active('system')}" data-settings-tab="system">System</button></div><div class="panel-body">${body}</div></div>`;
}

/*
 PURPOSE:
 Renders SaaS owner management with plans, tenants and sync status.
 REFERENCE:
 In production this area must be protected by a real PlatformAdmin authorization policy rather than the demo role check.
*/
function saasView() {
  return `<div class="page-header"><div><h1>SaaS Management</h1><p>Tenants, subscription plans, branches, users and platform operations</p></div><button class="btn-primary" id="loadSaasBtn">Refresh SaaS Data</button></div><div id="saasData"><div class="cards"><div class="metric blue"><div class="label">Tenants</div><div class="value">—</div></div><div class="metric green"><div class="label">Active Subscriptions</div><div class="value">—</div></div><div class="metric orange"><div class="label">Offline Queues</div><div class="value">Local</div></div><div class="metric purple"><div class="label">Platform Status</div><div class="value">Online</div></div></div><div class="section-note">Use the Refresh button to load tenant and plan data from the SaaS API.</div></div>`;
}

/*
 PURPOSE:
 Attaches only the controls required by the currently visible screen.
 REFERENCE:
 This avoids querying non-existent elements and keeps each feature block easy to follow.
*/
function bindCurrentScreen() {
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>{appState.view=btn.dataset.go;render();}));
  if (appState.view === 'pos') bindPos();
  if (appState.view === 'products') bindProducts();
  if (appState.view === 'purchase') bindPurchase();
  if (appState.view === 'stock') bindStock();
  if (appState.view === 'expiry') bindExpiry();
  if (appState.view === 'customers') bindPeople('customer');
  if (appState.view === 'suppliers') bindPeople('supplier');
  if (appState.view === 'reports') bindReports();
  if (appState.view === 'settings') bindSettings();
  if (appState.view === 'saas') bindSaas();
}

/*
 PURPOSE:
 Wires all POS interactions: product search, batch selection, quantities, payments and checkout.
 REFERENCE:
 Checkout always writes the transaction to IndexedDB before any network attempt.
*/
function bindPos() {
  const search = document.getElementById('posSearch');
  const filterProducts = () => {
    const q = (search.value || '').toLowerCase();
    document.querySelectorAll('.product-row').forEach(row => {
      const p = appState.products.find(x=>String(x.id)===row.dataset.productId);
      row.style.display = !q || `${p?.name} ${p?.genericName} ${p?.barcode}`.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  search?.addEventListener('input',filterProducts);
  document.getElementById('posSearchBtn')?.addEventListener('click', filterProducts);
  document.querySelectorAll('[data-product-id]').forEach(row=>row.addEventListener('click',()=>{appState.selectedProductId=Number(row.dataset.productId);const first=appState.batches.filter(b=>b.productId===appState.selectedProductId&&b.quantity>0&&daysLeft(b.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate))[0];appState.selectedBatchId=first?.id||null;render();}));
  document.querySelectorAll('[data-batch-id]').forEach(btn=>btn.addEventListener('click',()=>{appState.selectedBatchId=Number(btn.dataset.batchId);render();}));
  document.getElementById('addToCartBtn')?.addEventListener('click',addSelectedBatchToCart);
  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.addEventListener('click',()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();}));
  document.querySelectorAll('.cart-qty').forEach(input=>input.addEventListener('change',()=>{const item=appState.cart[Number(input.dataset.cartIndex)];item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));render();}));
  document.querySelectorAll('[data-payment]').forEach(btn=>btn.addEventListener('click',()=>{appState.paymentMethod=btn.dataset.payment;render();}));
  document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);
  document.getElementById('printBtn')?.addEventListener('click',()=>window.print());
  document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{ if(!appState.cart.length) return toast('Cart is empty.','warning'); appState.heldSales.push({id:Date.now(),cart:appState.cart,paymentMethod:appState.paymentMethod}); localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales)); appState.cart=[]; render(); toast('Sale held locally.'); });
}

/*
 PURPOSE:
 Adds the selected batch to the cart or increments an existing matching cart line.
 REFERENCE:
 Quantity cannot exceed the cached batch quantity.
*/
function addSelectedBatchToCart() {
  const batch=appState.batches.find(b=>b.id===appState.selectedBatchId);
  const product=appState.products.find(p=>p.id===batch?.productId);
  if (!batch || !product) return toast('Select a valid batch first.','error');
  const existing=appState.cart.find(x=>x.batchId===batch.id);
  if (existing) {
    if (existing.quantity >= batch.quantity) return toast('No more cached stock in this batch.','warning');
    existing.quantity += 1;
  } else {
    appState.cart.push({batchId:batch.id,productId:product.id,productName:product.name,batchNo:batch.batchNo,expiryDate:batch.expiryDate,unitPrice:Number(batch.sellingPrice),quantity:1,maxQty:Number(batch.quantity)});
  }
  render();
}

/*
 PURPOSE:
 Saves a sale locally first, updates cached stock, then attempts immediate server synchronization.
