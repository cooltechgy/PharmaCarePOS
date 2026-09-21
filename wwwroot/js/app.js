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
    ['dashboard','⌂','Dashboard'],['pos','🛒','POS (Sales)'],['cashier','💵','Cashier'],['products','💊','Products'],['purchase','▣','Purchase'],['stock','▤','Stock'],['expiry','⏰','Expiry Stock'],['customers','👥','Customers'],['suppliers','🚚','Suppliers'],['reports','📊','Reports']
  ];
  if (appState.session.role === 'PlatformAdmin') nav.unshift(['saas','☁','SaaS Admin']);
  nav.push(['settings','⚙','Settings']);
  return `
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand"><div class="logo-mark">✚</div><span>PharmaCare POS</span></div>
      <nav class="side-nav">${nav.map(n => `<a href="#" class="nav-item ${appState.view===n[0]?'active':''}" data-view="${n[0]}"><span class="nav-icon">${n[1]}</span><span class="nav-label">${n[2]}</span></a>`).join('')}</nav>
      <div class="side-footer">Smart Pharmacy Management<br>Offline-first SaaS POS<div class="version-badge">v6.5</div></div>
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
    case 'cashier': return cashierView();
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
          <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>${appState.cart.map((l,i)=>`<tr><td>${i+1}</td><td><b>${esc(l.productName)}</b>${l.directions?`<br><small class="directions-line">${esc(l.directions)}</small>`:''}</td><td>${esc(l.batchNo)}</td><td class="${daysLeft(l.expiryDate)<=30?'danger-text':''}">${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:72px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button> `:'' }<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Scan or select a medicine to begin.</td></tr>'}</tbody></table></div>
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
  } else if (tab === 'checkout') {
    const checkout=getCheckoutSettings();
    body = `
      <div class="section-note"><b>Checkout routing:</b> Choose the default action shown at POS. Both Pay Here and Send to Cashier remain available so staff can change the route for an individual order.</div>
      <div class="checkout-setting-cards">
        <label class="checkout-setting-card ${checkout.defaultRoute==='here'?'selected':''}">
          <input type="radio" name="defaultCheckoutRoute" value="here" ${checkout.defaultRoute==='here'?'checked':''}>
          <span class="checkout-setting-icon">💳</span>
          <span><b>Pay Here</b><small>Collect payment directly at the sale station. The sale is immediately payment complete.</small></span>
        </label>
        <label class="checkout-setting-card ${checkout.defaultRoute==='cashier'?'selected':''}">
          <input type="radio" name="defaultCheckoutRoute" value="cashier" ${checkout.defaultRoute==='cashier'?'checked':''}>
          <span class="checkout-setting-icon">💵</span>
          <span><b>Send to Cashier</b><small>Complete the order with Payment Status: Pending. Cashier collects payment later.</small></span>
        </label>
      </div>
      <div class="checkout-actions"><button class="btn-success" id="saveCheckoutSettingsBtn">Save Checkout Setting</button></div>`;
  } else if (tab === 'directions') {
    const templates=getDirectionTemplates();
    body = `
      <div class="section-note"><b>Quick Directions:</b> These are reusable text templates shown in the POS “How to Use” popup. They do not determine the correct dose; staff must use the prescription or authorized directions.</div>
      <div class="direction-settings-add">
        <input id="newDirectionTemplate" placeholder="Example: Take 1 after meals">
        <button class="btn-success" id="addDirectionTemplateBtn">+ Add Direction</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Direction Template</th><th>Action</th></tr></thead>
          <tbody>
            ${templates.map((text,i)=>`<tr><td>${i+1}</td><td><b>${esc(text)}</b></td><td class="nowrap"><button class="btn-primary btn-xs" data-edit-direction="${i}">Edit</button> <button class="btn-danger btn-xs" data-delete-direction="${i}">Delete</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No direction templates. Add one above.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="checkout-actions">
        <button class="btn-light" id="resetDirectionTemplatesBtn">Reset Default Directions</button>
      </div>`;
  } else if (tab === 'printers') {
    const ps=getPrinterSettings();
    body = `
      <div class="section-note"><b>Printer setup:</b> Browser Print opens the normal print dialog. Direct Print uses QZ Tray to send a job to the selected Windows/macOS/Linux printer by name. QZ Tray must be installed and trusted on this computer.</div>
      <div class="form-grid">
        <div class="field"><label>Print Mode</label><select id="printerMode"><option value="browser" ${ps.mode==='browser'?'selected':''}>Browser Print Dialog</option><option value="qz" ${ps.mode==='qz'?'selected':''}>Direct Print (QZ Tray)</option></select></div>
        <div class="field"><label>QZ Status</label><input id="qzStatus" value="Not checked" disabled></div>
        <div class="field"><label>Bill / Receipt Printer</label><input id="billPrinterName" list="printerNameList" value="${esc(ps.billPrinter||'')}" placeholder="Example: EPSON TM-T20III"></div>
        <div class="field"><label>Bill Paper Width</label><select id="billPaperWidth"><option value="80" ${String(ps.billWidth)==='80'?'selected':''}>80 mm</option><option value="58" ${String(ps.billWidth)==='58'?'selected':''}>58 mm</option></select></div>
        <div class="field"><label>Label Printer</label><input id="labelPrinterName" list="printerNameList" value="${esc(ps.labelPrinter||'')}" placeholder="Example: Zebra ZD220"></div>
        <div class="field"><label>Label Size</label><select id="labelSize"><option value="4x2" ${ps.labelSize==='4x2'?'selected':''}>4 × 2 in</option><option value="3x2" ${ps.labelSize==='3x2'?'selected':''}>3 × 2 in</option><option value="2x1" ${ps.labelSize==='2x1'?'selected':''}>2 × 1 in</option></select></div>
        <div class="field"><label class="check-row"><input id="autoPrintBill" type="checkbox" ${ps.autoPrintBill?'checked':''}><span><b>Auto print bill after sale</b><small>Print the receipt immediately after a completed sale.</small></span></label></div>
        <div class="field"><label class="check-row"><input id="autoPrintLabel" type="checkbox" ${ps.autoPrintLabel?'checked':''}><span><b>Auto print medicine label</b><small>Print directions label after it is confirmed.</small></span></label></div>
      </div>
      <datalist id="printerNameList"></datalist>
      <div class="checkout-actions">
        <button class="btn-light" id="detectPrintersBtn">Detect Printers</button>
        <button class="btn-primary" id="testBillPrinterBtn">Test Bill Printer</button>
        <button class="btn-purple" id="testLabelPrinterBtn">Test Label Printer</button>
        <button class="btn-success" id="savePrinterSettingsBtn">Save Printer Settings</button>
      </div>`;
  } else if (tab === 'backup') {
    body = `<div class="section-note"><b>Local backup:</b> downloads the current cached catalogue, batches, customers, suppliers and settings as JSON. This is useful for emergency export but is not a replacement for SQL Server backups.</div><div class="checkout-actions"><button class="btn-primary" id="downloadBackupBtn">Download JSON Backup</button><button class="btn-light" id="downloadProductsCsvBtn">Export Products CSV</button></div>`;
  } else {
    body = `<div class="form-grid"><div class="field"><label>Connection</label><input value="${navigator.onLine?'Online':'Offline'}" disabled></div><div class="field"><label>Pending Offline Sales</label><input id="pendingSalesCount" value="Checking..." disabled></div></div><div class="checkout-actions"><button class="btn-primary" id="systemSyncBtn">Sync Now</button><button class="btn-light" id="clearOfflineCacheBtn">Refresh Local Cache</button></div>`;
  }

  return `<div class="page-header"><div><h1>Settings</h1><p>Pharmacy, invoice, users, backup and system options</p></div></div><div class="panel"><div class="tabs"><button class="tab${active('general')}" data-settings-tab="general">General</button><button class="tab${active('invoice')}" data-settings-tab="invoice">Invoice</button><button class="tab${active('users')}" data-settings-tab="users">Users</button><button class="tab${active('checkout')}" data-settings-tab="checkout">Checkout</button><button class="tab${active('directions')}" data-settings-tab="directions">Directions</button><button class="tab${active('printers')}" data-settings-tab="printers">Printers</button><button class="tab${active('backup')}" data-settings-tab="backup">Backup</button><button class="tab${active('system')}" data-settings-tab="system">System</button></div><div class="panel-body">${body}</div></div>`;
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
  if (appState.view === 'cashier') bindCashier();
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
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());
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
 REFERENCE:
 Local-first persistence is the critical offline guarantee requested for internet outages.
*/
async function completeSale() {
  if (!appState.cart.length) return;
  const opId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const sale = {
    tenantId: appState.session.tenantId,
    branchId: appState.session.branchId,
    clientOperationId: opId,
    discount: 0,
    paymentMethod: appState.paymentMethod,
    lines: appState.cart.map(x=>({batchId:x.batchId,quantity:x.quantity})),
    localCreatedUtc: new Date().toISOString(),
    status: 'pending'
  };
  await PharmaOffline.put('pendingSales', opId, sale);
  for (const line of appState.cart) {
    const b=appState.batches.find(x=>x.id===line.batchId);
    if (b) b.quantity=Math.max(0,Number(b.quantity)-Number(line.quantity));
  }
  await PharmaOffline.replaceAll('batches',appState.batches);
  appState.cart=[];
  render();
  toast(navigator.onLine?'Sale saved locally. Synchronizing...':'Sale saved offline. It will sync automatically.','success');
  if (navigator.onLine) {
    await syncPendingSales();
    await refreshSnapshot();
    await loadDashboard();
    render();
  }
}

/*
 PURPOSE:
 Pushes all pending offline sales to the server one by one.
 REFERENCE:
 Conflict responses remain queued so stock discrepancies are not silently discarded.
*/
async function syncPendingSales() {
  if (!navigator.onLine || !appState.session || appState.session.role === 'PlatformAdmin') return;
  const sales=await PharmaOffline.all('pendingSales');
  for (const sale of sales) {
    try {
      await api('/api/sales',{method:'POST',body:JSON.stringify(sale)});
      await PharmaOffline.remove('pendingSales',sale.clientOperationId);
      toast(`Synced offline sale ${sale.clientOperationId.slice(0,8)}.`,'success');
    } catch (error) {
      sale.status='conflict';
      sale.lastError=error.message;
      await PharmaOffline.put('pendingSales',sale.clientOperationId,sale);
      toast(`Sale sync needs review: ${error.message}`,'error');
    }
  }
}

/*
 PURPOSE:
 Opens and submits the Add Product modal.
 REFERENCE:
 After saving online, the catalogue snapshot is refreshed into IndexedDB.
*/
function bindProducts() {
  document.getElementById('addProductBtn')?.addEventListener('click',showProductModal);
  document.getElementById('productFilter')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.getElementById('productTableBody').innerHTML=productRows(appState.products.filter(p=>`${p.name} ${p.genericName} ${p.brand}`.toLowerCase().includes(q))); bindProductEditButtons();});
  bindProductEditButtons();
}

/*
 PURPOSE:
 Displays the product-entry form closely matching the Add/Edit Product reference screen.
 REFERENCE:
 This modal is generated dynamically so the main page stays uncluttered.
*/
function showProductModal(product = null) {
  const host=document.createElement('div');host.className='modal-backdrop';host.innerHTML=`<div class="modal"><div class="modal-head"><b>${product ? 'Edit Product' : 'Add New Product'}</b><button class="close-btn" id="closeProductModal">×</button></div><form id="productForm"><div class="modal-body"><div class="tabs"><button type="button" class="tab active">Basic Info</button><button type="button" class="tab">Batch & Expiry</button><button type="button" class="tab">Pricing</button></div><div class="form-grid"><div class="field"><label>Product Name *</label><input id="pName" required value="${esc(product?.name || 'Amoxicillin 250mg')}"></div><div class="field"><label>Generic Name</label><input id="pGeneric" value="${esc(product?.genericName || 'Amoxicillin')}"></div><div class="field"><label>Category</label><input id="pCategory" value="${esc(product?.category || 'Antibiotic')}"></div><div class="field"><label>Brand</label><input id="pBrand" value="${esc(product?.brand || 'Amoxil')}"></div><div class="field"><label>Strength</label><input id="pStrength" value="${esc(product?.strength || '250mg')}"></div><div class="field"><label>Pack Size</label><input id="pPack" value="${esc(product?.packSize || '10 Capsules')}"></div><div class="field"><label>Barcode</label><input id="pBarcode" value="${esc(product?.barcode || Date.now())}"></div><div class="field"><label>Purchase Price</label><input id="pCost" type="number" step="0.01" value="${product?.purchasePrice ?? 18}"></div><div class="field"><label>Selling Price</label><input id="pSell" type="number" step="0.01" value="${product?.sellingPrice ?? 30}"></div><div class="field"><label><input id="pTrack" type="checkbox" ${product?.trackBatchExpiry===false?'':'checked'} style="width:auto"> Track Batch & Expiry</label></div><div class="field"><label><input id="pRx" type="checkbox" ${product?.requiresPrescription?'checked':''} style="width:auto"> Requires Prescription</label></div></div></div><div class="modal-foot"><button type="button" class="btn-light" id="cancelProduct">Cancel</button><button class="btn-primary" type="submit">Save Product</button></div></form></div>`;document.body.appendChild(host);
  const close=()=>host.remove();document.getElementById('closeProductModal').onclick=close;document.getElementById('cancelProduct').onclick=close;
  document.getElementById('productForm').addEventListener('submit',async e=>{e.preventDefault();if(!navigator.onLine)return toast('Adding a brand-new master product requires server connection in this demo.','warning');try{await api(product ? `/api/products/${product.id}` : '/api/products',{method:product ? 'PUT' : 'POST',body:JSON.stringify({tenantId:appState.session.tenantId,name:document.getElementById('pName').value,genericName:document.getElementById('pGeneric').value,strength:document.getElementById('pStrength').value,packSize:document.getElementById('pPack').value,category:document.getElementById('pCategory').value,brand:document.getElementById('pBrand').value,barcode:document.getElementById('pBarcode').value,sellingPrice:Number(document.getElementById('pSell').value),purchasePrice:Number(document.getElementById('pCost').value),trackBatchExpiry:document.getElementById('pTrack').checked,requiresPrescription:document.getElementById('pRx').checked})});await refreshSnapshot();close();render();toast('Product saved.');}catch(error){toast(error.message,'error')}});
}

/*
 PURPOSE:
 Wires the purchase form to the server GRN endpoint.
 REFERENCE:
 Purchase entry is intentionally online-only in this demo because offline receiving across multiple devices needs a stronger conflict policy than offline sales.
*/
function bindPurchase() {
  document.getElementById('cancelPurchaseBtn')?.addEventListener('click',()=>{appState.view='dashboard';render();});
  document.getElementById('purchaseProduct')?.addEventListener('change',e=>{const p=appState.products.find(x=>x.id===Number(e.target.value));if(p){document.getElementById('purchaseCost').value=p.purchasePrice;document.getElementById('purchaseSell').value=p.sellingPrice;}});
  document.getElementById('purchaseForm')?.addEventListener('submit',async e=>{e.preventDefault();if(!navigator.onLine)return toast('Purchase receiving requires internet in this demo.','warning');try{await api('/api/purchases',{method:'POST',body:JSON.stringify({tenantId:appState.session.tenantId,branchId:appState.session.branchId,supplierId:Number(document.getElementById('purchaseSupplier').value||0),invoiceNo:document.getElementById('purchaseInvoice').value,lines:[{productId:Number(document.getElementById('purchaseProduct').value),batchNo:document.getElementById('purchaseBatch').value,expiryDate:document.getElementById('purchaseExpiry').value,quantity:Number(document.getElementById('purchaseQty').value),purchasePrice:Number(document.getElementById('purchaseCost').value),sellingPrice:Number(document.getElementById('purchaseSell').value)}]})});await refreshSnapshot();render();toast('Purchase posted and stock updated.');}catch(error){toast(error.message,'error')}});
}

/*
 PURPOSE:
 Loads SaaS tenants and subscription plans into the platform screen.
 REFERENCE:
 This provides a working management view instead of the previous decorative shell.
*/
function bindSaas() {
  document.getElementById('loadSaasBtn')?.addEventListener('click',async()=>{try{const data=await api('/api/saas');const pending=(await PharmaOffline.all('pendingSales')).length;document.getElementById('saasData').innerHTML=`<div class="cards"><div class="metric blue"><div class="label">Tenants</div><div class="value">${data.tenants.length}</div></div><div class="metric green"><div class="label">Active</div><div class="value">${data.tenants.filter(t=>t.status==='Active').length}</div></div><div class="metric orange"><div class="label">Local Pending Sync</div><div class="value">${pending}</div></div><div class="metric purple"><div class="label">Plans</div><div class="value">${data.plans.length}</div></div></div><div class="grid-2"><div class="panel"><div class="panel-head">Tenant Companies</div><div class="panel-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Name</th><th>Plan</th><th>Status</th></tr></thead><tbody>${data.tenants.map(t=>`<tr><td>${esc(t.code)}</td><td><b>${esc(t.name)}</b></td><td><span class="badge blue">${esc(t.plan)}</span></td><td><span class="badge green">${esc(t.status)}</span></td></tr>`).join('')}</tbody></table></div></div></div><div><div class="saas-grid" style="grid-template-columns:1fr">${data.plans.map(p=>`<div class="plan-card"><h3>${esc(p.name)}</h3><div class="price">${money(p.monthlyPrice)}<small>/mo</small></div><div>${p.branchLimit} branches • ${p.userLimit} users</div></div>`).join('')}</div></div></div>`;}catch(error){toast(error.message,'error')}});
}

boot();

/*
 PURPOSE:
 Wires Edit buttons for products after a product table render/filter.
 REFERENCE:
 Table HTML can be replaced by search, so handlers are reattached each time.
*/
function bindProductEditButtons() {
  document.querySelectorAll('[data-edit-product]').forEach(btn => btn.addEventListener('click', () => {
    const product = appState.products.find(x => x.id === Number(btn.dataset.editProduct));
    if (product) showProductModal(product);
  }));
}

/*
 PURPOSE:
 Downloads simple CSV data without requiring an external spreadsheet library.
 REFERENCE:
 Used by Stock and Expiry export buttons.
*/
function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

/*
 PURPOSE:
 Wires stock search, status filter, export, sync and batch edit controls.
 REFERENCE:
 These controls were visual-only in v2 and now perform real actions.
*/
function bindStock() {
  document.getElementById('syncNowBtn')?.addEventListener('click', async()=>{ await syncPendingSales(); await refreshSnapshot(); render(); toast('Sync complete.'); });
  const filter = () => {
    const q=(document.getElementById('stockSearch')?.value||'').toLowerCase();
    const status=document.getElementById('stockStatus')?.value||'all';
    document.querySelectorAll('[data-stock-view]').forEach(btn => {
      const row=btn.closest('tr'); const batch=appState.batches.find(x=>x.id===Number(btn.dataset.stockView)); const product=appState.products.find(x=>x.id===batch?.productId);
      const dl=batch?daysLeft(batch.expiryDate):9999;
      const matchText=!q || `${product?.name} ${batch?.batchNo}`.toLowerCase().includes(q);
      const matchStatus=status==='all' || (status==='low'&&Number(batch?.quantity)<=10) || (status==='expiry'&&dl>=0&&dl<=60) || (status==='expired'&&dl<0);
      row.style.display=matchText&&matchStatus?'':'none';
    });
  };
  document.getElementById('stockSearch')?.addEventListener('input',filter);
  document.getElementById('stockStatus')?.addEventListener('change',filter);
  document.getElementById('exportStockBtn')?.addEventListener('click',()=>downloadCsv('stock.csv', [['Product','Batch','Expiry','Quantity','Selling Price'],...appState.batches.map(b=>[appState.products.find(p=>p.id===b.productId)?.name,b.batchNo,b.expiryDate,b.quantity,b.sellingPrice]) ]));
  document.querySelectorAll('[data-stock-view]').forEach(btn=>btn.addEventListener('click',()=>showStockModal(Number(btn.dataset.stockView))));
}

/*
 PURPOSE:
 Opens one batch record and allows quantity, expiry and selling-price correction.
 REFERENCE:
 Changes are persisted through /api/stock/{id} and then re-synchronized locally.
*/
function showStockModal(batchId) {
  const batch=appState.batches.find(x=>x.id===batchId); if(!batch) return;
  const product=appState.products.find(x=>x.id===batch.productId);
  const host=document.createElement('div'); host.className='modal-backdrop';
  host.innerHTML=`<div class="modal"><div class="modal-head"><b>Batch: ${esc(batch.batchNo)} — ${esc(product?.name||'')}</b><button class="close-btn" id="stockClose">×</button></div><div class="modal-body"><div class="form-grid"><div class="field"><label>Quantity</label><input id="stockQty" type="number" min="0" value="${batch.quantity}"></div><div class="field"><label>Expiry Date</label><input id="stockExpiry" type="date" value="${String(batch.expiryDate).slice(0,10)}"></div><div class="field"><label>Selling Price</label><input id="stockSell" type="number" step="0.01" value="${batch.sellingPrice}"></div></div></div><div class="modal-foot"><button class="btn-light" id="stockCancel">Cancel</button><button class="btn-success" id="stockSave">Save Changes</button></div></div>`;
  document.body.appendChild(host); const close=()=>host.remove(); document.getElementById('stockClose').onclick=close; document.getElementById('stockCancel').onclick=close;
  document.getElementById('stockSave').onclick=async()=>{ if(!navigator.onLine) return toast('Stock adjustment requires server connection.','warning'); try { await api(`/api/stock/${batch.id}`,{method:'PUT',body:JSON.stringify({tenantId:appState.session.tenantId,branchId:appState.session.branchId,quantity:Number(document.getElementById('stockQty').value),expiryDate:document.getElementById('stockExpiry').value,sellingPrice:Number(document.getElementById('stockSell').value)})}); await refreshSnapshot(); close(); render(); toast('Stock batch updated.'); } catch(e){ toast(e.message,'error'); } };
}

/*
 PURPOSE:
 Wires expiry period filtering and CSV export.
 REFERENCE:
 Allows the near-expiry report to be used instead of only viewed.
*/
function bindExpiry() {
  document.getElementById('expiryFilter')?.addEventListener('change', e => {
    const max=e.target.value==='all'?Infinity:Number(e.target.value);
    document.querySelectorAll('.data-table tbody tr').forEach(row=>{ const cells=row.children; const dl=Number(cells[3]?.textContent); row.style.display=dl<=max?'':'none'; });
  });
  document.getElementById('exportExpiryBtn')?.addEventListener('click',()=>downloadCsv('expiry-report.csv',[['Product','Batch','Expiry','Days Left','Quantity'],...appState.batches.sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate)).map(b=>[appState.products.find(p=>p.id===b.productId)?.name,b.batchNo,b.expiryDate,daysLeft(b.expiryDate),b.quantity])]));
}

/*
 PURPOSE:
 Wires customer/supplier searching and add/edit forms.
 REFERENCE:
 One shared implementation keeps both master-data screens consistent.
*/
function bindPeople(type) {
  document.getElementById('addPersonBtn')?.addEventListener('click',()=>showPersonModal(type));
  document.getElementById('peopleSearch')?.addEventListener('input',e=>{ const q=e.target.value.toLowerCase(); document.querySelectorAll('.data-table tbody tr').forEach(row=>row.style.display=row.textContent.toLowerCase().includes(q)?'':'none'); });
  document.querySelectorAll('[data-edit-person]').forEach(btn=>btn.addEventListener('click',()=>{ const list=type==='supplier'?appState.suppliers:appState.customers; showPersonModal(type,list.find(x=>x.id===Number(btn.dataset.editPerson))); }));
}

/*
 PURPOSE:
 Creates or edits one customer/supplier using the corresponding API endpoint.
 REFERENCE:
 Master records are online-only because they are shared configuration data, not offline sale transactions.
*/
function showPersonModal(type, item=null) {
  const supplier=type==='supplier'; const host=document.createElement('div'); host.className='modal-backdrop';
  host.innerHTML=`<div class="modal"><div class="modal-head"><b>${item?'Edit':'Add'} ${supplier?'Supplier':'Customer'}</b><button class="close-btn" id="personClose">×</button></div><form id="personForm"><div class="modal-body"><div class="form-grid"><div class="field"><label>Name *</label><input id="personName" required value="${esc(item?.name||'')}"></div>${supplier?`<div class="field"><label>Contact Person</label><input id="personContact" value="${esc(item?.contactPerson||'')}"></div>`:''}<div class="field"><label>Phone</label><input id="personPhone" value="${esc(item?.phone||'')}"></div><div class="field"><label>Email</label><input id="personEmail" type="email" value="${esc(item?.email||'')}"></div></div></div><div class="modal-foot"><button type="button" class="btn-light" id="personCancel">Cancel</button><button class="btn-success">Save</button></div></form></div>`;
  document.body.appendChild(host); const close=()=>host.remove(); document.getElementById('personClose').onclick=close; document.getElementById('personCancel').onclick=close;
  document.getElementById('personForm').addEventListener('submit',async e=>{ e.preventDefault(); if(!navigator.onLine)return toast('This master-data change requires internet.','warning'); const body={tenantId:appState.session.tenantId,name:document.getElementById('personName').value,phone:document.getElementById('personPhone').value,email:document.getElementById('personEmail').value}; if(supplier) body.contactPerson=document.getElementById('personContact').value; try { await api(`/api/${supplier?'suppliers':'customers'}${item?`/${item.id}`:''}`,{method:item?'PUT':'POST',body:JSON.stringify(body)}); await refreshSnapshot(); close(); render(); toast(`${supplier?'Supplier':'Customer'} saved.`); } catch(err){ toast(err.message,'error'); } });
}

/*
 PURPOSE:
 Loads sale report data and gives each report tile a useful result.
 REFERENCE:
 Sales/profit use server invoices; stock/expiry/customer reports use the synchronized local snapshot.
*/
function bindReports() {
  document.querySelectorAll('[data-report]').forEach(card=>card.addEventListener('click',async()=>{ const type=card.dataset.report; try { if(type==='stock'){downloadCsv('stock-report.csv',[['Product','Batch','Qty','Value'],...appState.batches.map(b=>[appState.products.find(p=>p.id===b.productId)?.name,b.batchNo,b.quantity,Number(b.quantity)*Number(b.purchasePrice)])]);return;} if(type==='expiry'){appState.view='expiry';render();return;} if(type==='customer'){downloadCsv('customers.csv',[['Name','Phone','Email'],...appState.customers.map(c=>[c.name,c.phone,c.email])]);return;} if(type==='purchase'){toast('Purchase stock receiving is working; purchase-history headers are the next module to expand.','info');return;} if(!navigator.onLine)return toast('Sales and profit reports require server connection.','warning'); const d=await api(`/api/reports/sales?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`); showSalesReportModal(d,type); } catch(e){toast(e.message,'error');} }));
}

/*
 PURPOSE:
 Displays recent server invoices or a simple gross-profit calculation.
 REFERENCE:
 Profit is calculated from recorded sale line price and current product purchase price in this demo.
*/
function showSalesReportModal(data,type) {
  const host=document.createElement('div'); host.className='modal-backdrop';
  const sales=data.sales||[]; const lines=data.lines||[];
  const rows=sales.map(s=>`<tr><td>${esc(s.invoiceNo)}</td><td>${fmtDate(s.createdUtc)}</td><td>${esc(s.paymentMethod)}</td><td>${money(s.total)}</td></tr>`).join('');
  const revenue=sales.reduce((a,b)=>a+Number(b.total),0); const cost=lines.reduce((a,l)=>{const p=appState.products.find(x=>x.id===l.productId);return a+Number(l.quantity)*Number(p?.purchasePrice||0)},0);
  host.innerHTML=`<div class="modal"><div class="modal-head"><b>${type==='profit'?'Profit & Loss':'Sales Report'}</b><button class="close-btn" id="reportClose">×</button></div><div class="modal-body">${type==='profit'?`<div class="cards"><div class="metric green"><div class="label">Revenue</div><div class="value">${money(revenue)}</div></div><div class="metric orange"><div class="label">Estimated Cost</div><div class="value">${money(cost)}</div></div><div class="metric blue"><div class="label">Gross Profit</div><div class="value">${money(revenue-cost)}</div></div></div>`:`<div class="table-wrap"><table class="data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Payment</th><th>Total</th></tr></thead><tbody>${rows||'<tr><td colspan="4">No sales yet.</td></tr>'}</tbody></table></div>`}</div></div>`;
  document.body.appendChild(host); document.getElementById('reportClose').onclick=()=>host.remove();
}

/*
 PURPOSE:
 Loads settings once and persists changes to the tenant settings endpoint.
 REFERENCE:
 The visible settings form now survives refresh and another browser session.
*/
async function bindSettings() {
  if(navigator.onLine && !appState.settings){
    try { appState.settings=await api(`/api/settings?tenantId=${appState.session.tenantId}`); render(); return; }
    catch { appState.settings={pharmacyName:appState.session.tenantName,address:'',currency:'USD',invoicePrefix:'INV',expiryAlertDays:60}; }
  }

  document.querySelectorAll('[data-settings-tab]').forEach(btn=>btn.addEventListener('click',()=>{
    appState.settingsTab=btn.dataset.settingsTab;
    render();
  }));

  const saveSettings = async (patch={}) => {
    if(!navigator.onLine) return toast('Saving shared settings requires internet.','warning');
    const current = appState.settings || {};
    const payload={
      tenantId:appState.session.tenantId,
      pharmacyName:patch.pharmacyName ?? current.pharmacyName ?? appState.session.tenantName,
      address:patch.address ?? current.address ?? '',
      currency:patch.currency ?? current.currency ?? 'USD',
      invoicePrefix:patch.invoicePrefix ?? current.invoicePrefix ?? 'INV',
      expiryAlertDays:Number(patch.expiryAlertDays ?? current.expiryAlertDays ?? 60)
    };
    appState.settings=await api('/api/settings',{method:'PUT',body:JSON.stringify(payload)});
    appState.session.tenantName=appState.settings.pharmacyName;
    localStorage.setItem('pharmacare.session',JSON.stringify(appState.session));
    toast('Settings saved.');
    render();
  };

  document.getElementById('saveGeneralSettingsBtn')?.addEventListener('click',async()=>{
    try { await saveSettings({pharmacyName:document.getElementById('setName').value.trim(),address:document.getElementById('setAddress').value.trim(),currency:document.getElementById('setCurrency').value,expiryAlertDays:Number(document.getElementById('setExpiryDays').value)}); }
    catch(e){ toast(e.message,'error'); }
  });

  document.getElementById('saveInvoiceSettingsBtn')?.addEventListener('click',async()=>{
    try { await saveSettings({invoicePrefix:document.getElementById('setPrefix').value.trim() || 'INV',currency:document.getElementById('invoiceCurrency').value}); }
    catch(e){ toast(e.message,'error'); }
  });

  document.getElementById('previewInvoiceBtn')?.addEventListener('click',()=>{
    const prefix=document.getElementById('setPrefix')?.value || appState.settings?.invoicePrefix || 'INV';
    alert(`${appState.settings?.pharmacyName || appState.session.tenantName}\nInvoice: ${prefix}-000001\nCurrency: ${document.getElementById('invoiceCurrency')?.value || appState.settings?.currency || 'USD'}`);
  });

  document.getElementById('loadSettingsUsersBtn')?.addEventListener('click',async()=>{
    try { appState.settingsUsers=await api(`/api/users?tenantId=${appState.session.tenantId}`); render(); }
    catch(e){ toast(e.message,'error'); }
  });

  document.getElementById('addSettingsUserBtn')?.addEventListener('click',()=>showAddSettingsUserModal());

  document.getElementById('saveCheckoutSettingsBtn')?.addEventListener('click',()=>{
    const route=document.querySelector('input[name="defaultCheckoutRoute"]:checked')?.value||'here';
    saveCheckoutSettings({defaultRoute:route});
    toast(route==='cashier'?'Default checkout set to Send to Cashier.':'Default checkout set to Pay Here.');
    render();
  });

  /*
   PURPOSE:
   Wires Settings > Directions add, edit, delete and reset actions.
   REFERENCE:
   The POS How to Use popup reads these templates through getDirectionTemplates().
  */
  document.getElementById('addDirectionTemplateBtn')?.addEventListener('click',()=>{
    const input=document.getElementById('newDirectionTemplate');
    const value=input?.value.trim();
    if(!value)return toast('Enter a direction template first.','warning');
    const templates=getDirectionTemplates();
    if(templates.some(x=>x.toLowerCase()===value.toLowerCase()))return toast('That direction already exists.','warning');
    templates.push(value);
    saveDirectionTemplates(templates);
    render();
    toast('Direction template added.');
  });
  document.getElementById('newDirectionTemplate')?.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      e.preventDefault();
      document.getElementById('addDirectionTemplateBtn')?.click();
    }
  });
  document.querySelectorAll('[data-edit-direction]').forEach(btn=>btn.addEventListener('click',()=>{
    const index=Number(btn.dataset.editDirection);
    const templates=getDirectionTemplates();
    const current=templates[index];
    const replacement=prompt('Edit direction template:',current);
    if(replacement===null)return;
    const value=replacement.trim();
    if(!value)return toast('Direction cannot be blank.','warning');
    templates[index]=value;
    saveDirectionTemplates(templates);
    render();
    toast('Direction template updated.');
  }));
  document.querySelectorAll('[data-delete-direction]').forEach(btn=>btn.addEventListener('click',()=>{
    const index=Number(btn.dataset.deleteDirection);
    const templates=getDirectionTemplates();
    if(index<0||index>=templates.length)return;
    templates.splice(index,1);
    saveDirectionTemplates(templates);
    render();
    toast('Direction template deleted.');
  }));
  document.getElementById('resetDirectionTemplatesBtn')?.addEventListener('click',()=>{
    saveDirectionTemplates(defaultDirectionTemplates());
    render();
    toast('Default directions restored.');
  });

  document.getElementById('savePrinterSettingsBtn')?.addEventListener('click',()=>{
    const settings={
      mode:document.getElementById('printerMode').value,
      billPrinter:document.getElementById('billPrinterName').value.trim(),
      labelPrinter:document.getElementById('labelPrinterName').value.trim(),
      billWidth:Number(document.getElementById('billPaperWidth').value||80),
      labelSize:document.getElementById('labelSize').value,
      autoPrintBill:document.getElementById('autoPrintBill').checked,
      autoPrintLabel:document.getElementById('autoPrintLabel').checked
    };
    savePrinterSettings(settings);
    toast('Printer settings saved.');
  });
  document.getElementById('detectPrintersBtn')?.addEventListener('click',async()=>{
    try{
      const printers=await detectQzPrinters();
      const list=document.getElementById('printerNameList');
      if(list)list.innerHTML=printers.map(p=>`<option value="${esc(p)}"></option>`).join('');
      const status=document.getElementById('qzStatus');
      if(status)status.value=`Connected • ${printers.length} printer(s)`;
      toast(`${printers.length} printer(s) detected.`);
    }catch(e){
      const status=document.getElementById('qzStatus');
      if(status)status.value='QZ Tray not connected';
      toast(e.message,'warning');
    }
  });
  document.getElementById('testBillPrinterBtn')?.addEventListener('click',async()=>{
    const ps=readPrinterSettingsFromForm();
    savePrinterSettings(ps);
    await printHtmlToConfiguredPrinter('bill',buildTestBillHtml(),true);
  });
  document.getElementById('testLabelPrinterBtn')?.addEventListener('click',async()=>{
    const ps=readPrinterSettingsFromForm();
    savePrinterSettings(ps);
    await printHtmlToConfiguredPrinter('label',buildTestLabelHtml(),true);
  });

  document.getElementById('downloadBackupBtn')?.addEventListener('click',()=>{
    const backup={exportedUtc:new Date().toISOString(),tenantId:appState.session.tenantId,branchId:appState.session.branchId,settings:appState.settings,products:appState.products,batches:appState.batches,customers:appState.customers,suppliers:appState.suppliers};
    downloadText(`pharmacare-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(backup,null,2),'application/json');
  });
  document.getElementById('downloadProductsCsvBtn')?.addEventListener('click',()=>{
    const rows=[['Name','Generic','Strength','Brand','Barcode','Selling Price'],...appState.products.map(p=>[p.name,p.genericName,p.strength,p.brand,p.barcode,p.sellingPrice])];
    downloadText('products.csv',rows.map(r=>r.map(csvCell).join(',')).join('\n'),'text/csv');
  });

  document.getElementById('systemSyncBtn')?.addEventListener('click',async()=>{
    try { await syncPendingSales(); await refreshSnapshot(); await loadDashboard(); toast('Sync completed.'); render(); }
    catch(e){ toast(e.message,'error'); }
  });
  document.getElementById('clearOfflineCacheBtn')?.addEventListener('click',async()=>{
    try { if(navigator.onLine) { await refreshSnapshot(); toast('Local cache refreshed from server.'); render(); } else toast('Internet is required to refresh the cache.','warning'); }
    catch(e){ toast(e.message,'error'); }
  });
  if(appState.settingsTab==='system') updatePendingSalesCount();
}

/* PURPOSE: Opens the Settings > Users dialog and creates a real tenant user. REFERENCE: Settings Users tab must have working controls. */
function showAddSettingsUserModal(){
  const host=document.createElement('div'); host.className='modal-backdrop';
  host.innerHTML=`<div class="modal"><div class="modal-head"><b>Add User</b><button class="close-btn" id="settingsUserClose">×</button></div><div class="modal-body"><div class="form-grid"><div class="field"><label>Username</label><input id="newSetUsername"></div><div class="field"><label>Password</label><input id="newSetPassword" type="password"></div><div class="field"><label>Display Name</label><input id="newSetDisplayName"></div><div class="field"><label>Role</label><select id="newSetRole"><option>Cashier</option><option>Pharmacist</option><option>Manager</option><option>Admin</option></select></div></div></div><div class="modal-foot"><button class="btn-light" id="settingsUserCancel">Cancel</button><button class="btn-success" id="settingsUserSave">Create User</button></div></div>`;
  document.body.appendChild(host);
  const close=()=>host.remove(); document.getElementById('settingsUserClose').onclick=close; document.getElementById('settingsUserCancel').onclick=close;
  document.getElementById('settingsUserSave').onclick=async()=>{
    try {
      await api('/api/users',{method:'POST',body:JSON.stringify({tenantId:appState.session.tenantId,branchId:appState.session.branchId,username:document.getElementById('newSetUsername').value.trim(),password:document.getElementById('newSetPassword').value,displayName:document.getElementById('newSetDisplayName').value.trim(),role:document.getElementById('newSetRole').value})});
      appState.settingsUsers=await api(`/api/users?tenantId=${appState.session.tenantId}`); close(); toast('User created.'); render();
    } catch(e){ toast(e.message,'error'); }
  };
}

/* PURPOSE: Downloads generated text without requiring a server round trip. REFERENCE: Used by Settings backup/export buttons. */
function downloadText(filename,text,type){ const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
/* PURPOSE: Escapes one CSV value for safe spreadsheet export. REFERENCE: Settings product export. */
function csvCell(value){ const s=String(value??''); return `"${s.replaceAll('"','""')}"`; }
/* PURPOSE: Displays the number of locally queued offline sales. REFERENCE: Settings System tab. */
async function updatePendingSalesCount(){ try { const pending=await PharmaOffline.all('pendingSales'); const el=document.getElementById('pendingSalesCount'); if(el)el.value=String(pending.length); } catch{} }

/* ============================================================================
 V4 FUNCTIONAL OVERRIDES
 PURPOSE:
 Fixes the New Item workflow and adds patient medical/emergency profiles,
 patient medicine history, product sales history, RxNorm import and images.
 REFERENCE:
 These functions intentionally override earlier renderer/binder declarations.
============================================================================ */

/* PURPOSE: Render products with photo, RxNorm metadata, history and import tools. REFERENCE: V4 product-management requirement. */
function productsView() {
  return `<div class="page-header"><div><h1>Products / Medicines</h1><p>Medicine master, photos, pricing and item sales history</p></div><div class="header-actions"><button class="btn-success" id="importRxNormBtn">⬇ Import RxNorm Medicines</button><button class="btn-primary" id="addProductBtn">+ New Item</button></div></div>
  <div class="import-note"><b>Medicine catalogue:</b> Import uses active RxNorm clinical/branded drug concepts. Imported medicines receive a placeholder image first; use <b>Find Photo</b> on a product to attempt a DailyMed label-media match.</div>
  <div id="productImportStatus"></div>
  <div class="panel"><div class="panel-body"><div class="toolbar"><input class="grow" id="productFilter" placeholder="Search product, generic, brand, RxNorm ID..."><button class="btn-light" id="exportProductsBtn">Export CSV</button></div>
  <div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Medicine</th><th>Strength</th><th>Brand</th><th>RxNorm</th><th>Price</th><th>Stock</th><th>Action</th></tr></thead><tbody id="productTableBody">${productRows(appState.products)}</tbody></table></div></div></div>`;
}

/* PURPOSE: Build product rows including image and working history/photo buttons. REFERENCE: Product item must have sales history and photo. */
function productRows(products) {
  return products.map((p,i)=>`<tr><td>${i+1}</td><td><img class="product-photo" src="${esc(p.imageUrl||'/images/medicine-placeholder.svg')}" onerror="this.src='/images/medicine-placeholder.svg'"><b>${esc(p.name)}</b><br><small class="muted">${esc(p.genericName||'')}</small></td><td>${esc(p.strength||p.dosageForm||'')}</td><td>${esc(p.brand||'')}</td><td>${esc(p.rxNormId||'—')}</td><td>${money(p.sellingPrice)}</td><td><span class="badge ${stockForProduct(p.id)<=10?'orange':'green'}">${stockForProduct(p.id)}</span></td><td class="nowrap"><button class="btn-primary btn-xs" data-edit-product="${p.id}">Edit</button> <button class="btn-purple btn-xs" data-product-history="${p.id}">Sales History</button> <button class="btn-light btn-xs" data-product-photo="${p.id}">Find Photo</button></td></tr>`).join('');
}

/* PURPOSE: Wire New Item without loading data, product history, photo enrichment and RxNorm import. REFERENCE: Fixes prior Event-object New Item bug. */
function bindProducts() {
  document.getElementById('addProductBtn')?.addEventListener('click', () => showProductModal());
  document.getElementById('productFilter')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.getElementById('productTableBody').innerHTML=productRows(appState.products.filter(p=>`${p.name} ${p.genericName} ${p.brand} ${p.rxNormId}`.toLowerCase().includes(q))); bindProductV4Buttons();});
  document.getElementById('exportProductsBtn')?.addEventListener('click',()=>downloadCsv('medicine-master.csv',[['Name','Generic','Strength','Brand','RxNormId','PurchasePrice','SellingPrice','Stock'],...appState.products.map(p=>[p.name,p.genericName,p.strength,p.brand,p.rxNormId,p.purchasePrice,p.sellingPrice,stockForProduct(p.id)])]));
  document.getElementById('importRxNormBtn')?.addEventListener('click', importRxNormMedicines);
  bindProductV4Buttons();
}

/* PURPOSE: Rebind dynamically generated product buttons. REFERENCE: Filtering replaces table HTML. */
function bindProductV4Buttons(){
  document.querySelectorAll('[data-edit-product]').forEach(btn=>btn.onclick=()=>{const p=appState.products.find(x=>x.id===Number(btn.dataset.editProduct));if(p)showProductModal(p);});
  document.querySelectorAll('[data-product-history]').forEach(btn=>btn.onclick=()=>showProductSalesHistory(Number(btn.dataset.productHistory)));
  document.querySelectorAll('[data-product-photo]').forEach(btn=>btn.onclick=()=>enrichProductPhoto(Number(btn.dataset.productPhoto),btn));
}

/* PURPOSE: Open a clean New Item form immediately with no API request; also edits existing products. REFERENCE: User reported New Item hung while loading. */
function showProductModal(product = null) {
  const host=document.createElement('div'); host.className='modal-backdrop';
  host.innerHTML=`<div class="modal wide"><div class="modal-head"><b>${product?'Edit Medicine':'New Medicine Item'}</b><button class="close-btn" id="closeProductModal">×</button></div><form id="productForm"><div class="modal-body"><div class="form-grid">
    <div class="field"><label>Product Name *</label><input id="pName" required value="${esc(product?.name||'')}"></div>
    <div class="field"><label>Generic Name</label><input id="pGeneric" value="${esc(product?.genericName||'')}"></div>
    <div class="field"><label>Strength</label><input id="pStrength" value="${esc(product?.strength||'')}"></div>
    <div class="field"><label>Dosage Form</label><input id="pDosageForm" placeholder="Tablet, capsule, syrup..." value="${esc(product?.dosageForm||'')}"></div>
    <div class="field"><label>Pack Size</label><input id="pPack" value="${esc(product?.packSize||'')}"></div>
    <div class="field"><label>Category</label><input id="pCategory" value="${esc(product?.category||'')}"></div>
    <div class="field"><label>Brand</label><input id="pBrand" value="${esc(product?.brand||'')}"></div>
    <div class="field"><label>Manufacturer</label><input id="pManufacturer" value="${esc(product?.manufacturer||'')}"></div>
    <div class="field"><label>Barcode</label><input id="pBarcode" value="${esc(product?.barcode||'')}"></div>
    <div class="field"><label>RxNorm ID</label><input id="pRxNorm" value="${esc(product?.rxNormId||'')}"></div>
    <div class="field"><label>Purchase Price</label><input id="pCost" type="number" step="0.01" min="0" value="${product?.purchasePrice??0}"></div>
    <div class="field"><label>Selling Price</label><input id="pSell" type="number" step="0.01" min="0" value="${product?.sellingPrice??0}"></div>
    <div class="field full"><label>Photo URL</label><input id="pImage" placeholder="https://... or /images/..." value="${esc(product?.imageUrl||'/images/medicine-placeholder.svg')}"></div>
    <div class="field full"><label>Notes</label><input id="pNotes" value="${esc(product?.notes||'')}"></div>
    <div class="field"><label><input id="pTrack" type="checkbox" ${product?.trackBatchExpiry===false?'':'checked'} style="width:auto"> Track Batch & Expiry</label></div>
    <div class="field"><label><input id="pRx" type="checkbox" ${product?.requiresPrescription?'checked':''} style="width:auto"> Requires Prescription</label></div>
  </div></div><div class="modal-foot"><button type="button" class="btn-light" id="cancelProduct">Cancel</button><button class="btn-success" type="submit">Save Medicine</button></div></form></div>`;
  document.body.appendChild(host); const close=()=>host.remove(); document.getElementById('closeProductModal').onclick=close; document.getElementById('cancelProduct').onclick=close;
  document.getElementById('productForm').onsubmit=async e=>{e.preventDefault();if(!navigator.onLine)return toast('Saving a new medicine requires internet.','warning');const body={tenantId:appState.session.tenantId,name:document.getElementById('pName').value.trim(),genericName:document.getElementById('pGeneric').value.trim(),strength:document.getElementById('pStrength').value.trim(),dosageForm:document.getElementById('pDosageForm').value.trim(),packSize:document.getElementById('pPack').value.trim(),category:document.getElementById('pCategory').value.trim(),brand:document.getElementById('pBrand').value.trim(),manufacturer:document.getElementById('pManufacturer').value.trim(),barcode:document.getElementById('pBarcode').value.trim(),rxNormId:document.getElementById('pRxNorm').value.trim(),imageUrl:document.getElementById('pImage').value.trim(),notes:document.getElementById('pNotes').value.trim(),sellingPrice:Number(document.getElementById('pSell').value||0),purchasePrice:Number(document.getElementById('pCost').value||0),trackBatchExpiry:document.getElementById('pTrack').checked,requiresPrescription:document.getElementById('pRx').checked};try{await api(product?`/api/products/${product.id}`:'/api/products',{method:product?'PUT':'POST',body:JSON.stringify(body)});await refreshSnapshot();close();render();toast('Medicine saved.');}catch(err){toast(err.message,'error')}};
}

/* PURPOSE: Import all active RxNorm clinical/branded drug concepts into tenant medicine master. REFERENCE: Uses server-side RxNorm importer. */
async function importRxNormMedicines(){
  if(!navigator.onLine)return toast('Medicine import requires internet.','warning');
  const status=document.getElementById('productImportStatus'); if(status)status.innerHTML='<div class="loading-strip"></div><div class="section-note">Importing active RxNorm clinical and branded drug concepts. Keep this page open until the server responds.</div>';
  try{const result=await api('/api/medicines/import-rxnorm',{method:'POST',body:JSON.stringify({tenantId:appState.session.tenantId,limit:0})});await refreshSnapshot();render();toast(`Medicine import complete: ${result.added} added, ${result.skipped} skipped.`);}catch(err){if(status)status.innerHTML='';toast(err.message,'error');}
}

/* PURPOSE: Try to match one product to a real DailyMed label-media image. REFERENCE: DailyMed images are not available for every RxNorm concept. */
async function enrichProductPhoto(productId,button){if(!navigator.onLine)return toast('Photo lookup requires internet.','warning');button.disabled=true;button.textContent='Finding...';try{const result=await api(`/api/products/${productId}/enrich-image?tenantId=${appState.session.tenantId}`,{method:'POST'});await refreshSnapshot();render();toast(result.matched?'DailyMed image matched.':'No DailyMed image found for this medicine.',result.matched?'success':'warning');}catch(err){button.disabled=false;button.textContent='Find Photo';toast(err.message,'error')}}

/* PURPOSE: Show every recorded sale for one item. REFERENCE: ProductId and SaleLine provide invoice/batch/quantity/revenue history. */
async function showProductSalesHistory(productId){if(!navigator.onLine)return toast('Sales history requires server connection.','warning');try{const d=await api(`/api/products/${productId}/sales-history?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);const host=document.createElement('div');host.className='modal-backdrop';host.innerHTML=`<div class="modal wide"><div class="modal-head"><b>Sales History — ${esc(d.product.name)}</b><button class="close-btn" id="phClose">×</button></div><div class="modal-body"><div class="cards"><div class="metric blue"><div class="label">Transactions</div><div class="value">${d.rows.length}</div></div><div class="metric green"><div class="label">Units Sold</div><div class="value">${d.rows.reduce((a,r)=>a+Number(r.quantity),0)}</div></div><div class="metric purple"><div class="label">Revenue</div><div class="value">${money(d.rows.reduce((a,r)=>a+Number(r.lineTotal),0))}</div></div></div><div class="table-wrap history-table"><table class="data-table"><thead><tr><th>Invoice</th><th>Date</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${d.rows.map(r=>`<tr><td>${esc(r.invoiceNo)}</td><td>${fmtDate(r.createdUtc)}</td><td>${esc(r.batchNo)}</td><td>${fmtDate(r.expiryDate)}</td><td>${r.quantity}</td><td>${money(r.unitPrice)}</td><td>${money(r.lineTotal)}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">No sales recorded for this item.</td></tr>'}</tbody></table></div></div></div>`;document.body.appendChild(host);document.getElementById('phClose').onclick=()=>host.remove();}catch(err){toast(err.message,'error')}}

/* PURPOSE: Render detailed patient/customer records with emergency and medical information. REFERENCE: Pharmacy customer profile requirement. */
function customersView(){
  return `<div class="page-header"><div><h1>Customers / Patients</h1><p>Contact, emergency, medical profile and complete medicine history</p></div><button class="btn-primary" id="addPersonBtn">+ Add Patient</button></div><div class="panel"><div class="panel-body"><div class="toolbar"><input class="grow" id="peopleSearch" placeholder="Search patient, phone, allergy, doctor..."></div><div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Patient</th><th>Phone</th><th>DOB / Sex</th><th>Allergies</th><th>Emergency</th><th>Action</th></tr></thead><tbody>${appState.customers.map((c,i)=>`<tr><td>${i+1}</td><td><b>${esc(c.name)}</b><br><small>${esc(c.email||'')}</small></td><td>${esc(c.phone||'')}</td><td>${c.dateOfBirth?fmtDate(c.dateOfBirth):'—'} / ${esc(c.sex||'—')}</td><td>${esc(c.allergies||'None recorded')}</td><td>${esc(c.emergencyContactName||'—')}<br><small>${esc(c.emergencyContactPhone||'')}</small></td><td><button class="btn-purple btn-xs" data-profile-customer="${c.id}">Medical Record</button> <button class="btn-primary btn-xs" data-edit-person="${c.id}">Edit</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">No patients.</td></tr>'}</tbody></table></div></div></div>`;
}

/* PURPOSE: Wire customer detailed profile/history or standard supplier CRUD. REFERENCE: Customer now has richer workflow than supplier. */
function bindPeople(type){
  document.getElementById('addPersonBtn')?.addEventListener('click',()=>showPersonModal(type));
  document.getElementById('peopleSearch')?.addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.data-table tbody tr').forEach(row=>row.style.display=row.textContent.toLowerCase().includes(q)?'':'none')});
  document.querySelectorAll('[data-edit-person]').forEach(btn=>btn.onclick=()=>{const list=type==='supplier'?appState.suppliers:appState.customers;showPersonModal(type,list.find(x=>x.id===Number(btn.dataset.editPerson)))});
  if(type==='customer')document.querySelectorAll('[data-profile-customer]').forEach(btn=>btn.onclick=()=>showCustomerMedicalRecord(Number(btn.dataset.profileCustomer)));
}

/* PURPOSE: Create/edit detailed customer or normal supplier. REFERENCE: Customer fields include medical and emergency details requested by user. */
function showPersonModal(type,item=null){
  const supplier=type==='supplier',host=document.createElement('div');host.className='modal-backdrop';
  if(supplier){host.innerHTML=`<div class="modal"><div class="modal-head"><b>${item?'Edit':'Add'} Supplier</b><button class="close-btn" id="personClose">×</button></div><form id="personForm"><div class="modal-body"><div class="form-grid"><div class="field"><label>Name *</label><input id="personName" required value="${esc(item?.name||'')}"></div><div class="field"><label>Contact Person</label><input id="personContact" value="${esc(item?.contactPerson||'')}"></div><div class="field"><label>Phone</label><input id="personPhone" value="${esc(item?.phone||'')}"></div><div class="field"><label>Email</label><input id="personEmail" value="${esc(item?.email||'')}"></div></div></div><div class="modal-foot"><button type="button" class="btn-light" id="personCancel">Cancel</button><button class="btn-success">Save</button></div></form></div>`;}
  else{host.innerHTML=`<div class="modal wide"><div class="modal-head"><b>${item?'Edit':'Add'} Patient</b><button class="close-btn" id="personClose">×</button></div><form id="personForm"><div class="modal-body"><div class="form-grid"><div class="field"><label>Full Name *</label><input id="personName" required value="${esc(item?.name||'')}"></div><div class="field"><label>Date of Birth</label><input id="personDob" type="date" value="${item?.dateOfBirth?String(item.dateOfBirth).slice(0,10):''}"></div><div class="field"><label>Sex</label><select id="personSex"><option></option>${['Female','Male','Other','Prefer not to say'].map(x=>`<option ${item?.sex===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Phone</label><input id="personPhone" value="${esc(item?.phone||'')}"></div><div class="field"><label>Email</label><input id="personEmail" value="${esc(item?.email||'')}"></div><div class="field"><label>Address</label><input id="personAddress" value="${esc(item?.address||'')}"></div><div class="field full"><label>Allergies</label><input id="personAllergies" placeholder="Drug/food allergies and reactions" value="${esc(item?.allergies||'')}"></div><div class="field full"><label>Medical Conditions</label><input id="personConditions" placeholder="Diabetes, hypertension, asthma..." value="${esc(item?.medicalConditions||'')}"></div><div class="field full"><label>Current Medications</label><input id="personCurrentMeds" value="${esc(item?.currentMedications||'')}"></div><div class="field"><label>Doctor Name</label><input id="personDoctor" value="${esc(item?.doctorName||'')}"></div><div class="field"><label>Doctor Phone</label><input id="personDoctorPhone" value="${esc(item?.doctorPhone||'')}"></div><div class="field"><label>Emergency Contact</label><input id="personEmergency" value="${esc(item?.emergencyContactName||'')}"></div><div class="field"><label>Relationship</label><input id="personEmergencyRel" value="${esc(item?.emergencyContactRelationship||'')}"></div><div class="field"><label>Emergency Phone</label><input id="personEmergencyPhone" value="${esc(item?.emergencyContactPhone||'')}"></div><div class="field full"><label>Medical / Pharmacy Notes</label><input id="personNotes" value="${esc(item?.notes||'')}"></div></div></div><div class="modal-foot"><button type="button" class="btn-light" id="personCancel">Cancel</button><button class="btn-success">Save Patient</button></div></form></div>`;}
  document.body.appendChild(host);const close=()=>host.remove();document.getElementById('personClose').onclick=close;document.getElementById('personCancel').onclick=close;
  document.getElementById('personForm').onsubmit=async e=>{e.preventDefault();if(!navigator.onLine)return toast('Saving master data requires internet.','warning');let body;if(supplier)body={tenantId:appState.session.tenantId,name:document.getElementById('personName').value,contactPerson:document.getElementById('personContact').value,phone:document.getElementById('personPhone').value,email:document.getElementById('personEmail').value};else body={tenantId:appState.session.tenantId,name:document.getElementById('personName').value,dateOfBirth:document.getElementById('personDob').value||null,sex:document.getElementById('personSex').value,phone:document.getElementById('personPhone').value,email:document.getElementById('personEmail').value,address:document.getElementById('personAddress').value,allergies:document.getElementById('personAllergies').value,medicalConditions:document.getElementById('personConditions').value,currentMedications:document.getElementById('personCurrentMeds').value,doctorName:document.getElementById('personDoctor').value,doctorPhone:document.getElementById('personDoctorPhone').value,emergencyContactName:document.getElementById('personEmergency').value,emergencyContactRelationship:document.getElementById('personEmergencyRel').value,emergencyContactPhone:document.getElementById('personEmergencyPhone').value,notes:document.getElementById('personNotes').value};try{await api(`/api/${supplier?'suppliers':'customers'}${item?`/${item.id}`:''}`,{method:item?'PUT':'POST',body:JSON.stringify(body)});await refreshSnapshot();close();render();toast(`${supplier?'Supplier':'Patient'} saved.`)}catch(err){toast(err.message,'error')}};
}

/* PURPOSE: Show patient emergency/medical record plus medicine purchase history. REFERENCE: History is derived from linked sale invoices and sale lines. */
async function showCustomerMedicalRecord(id){if(!navigator.onLine)return toast('Medical record history requires server connection.','warning');try{const d=await api(`/api/customers/${id}/history?tenantId=${appState.session.tenantId}`),c=d.customer,saleMap=Object.fromEntries(d.sales.map(s=>[s.id,s]));const host=document.createElement('div');host.className='modal-backdrop';host.innerHTML=`<div class="modal wide"><div class="modal-head"><b>Patient Medical Record — ${esc(c.name)}</b><button class="close-btn" id="cmClose">×</button></div><div class="modal-body"><div class="profile-grid"><div class="profile-card"><h4>Patient Details</h4><div class="profile-line"><b>DOB:</b> ${c.dateOfBirth?fmtDate(c.dateOfBirth):'—'} &nbsp; <b>Sex:</b> ${esc(c.sex||'—')}</div><div class="profile-line"><b>Phone:</b> ${esc(c.phone||'—')}</div><div class="profile-line"><b>Email:</b> ${esc(c.email||'—')}</div><div class="profile-line"><b>Address:</b> ${esc(c.address||'—')}</div></div><div class="profile-card"><h4>Emergency Information</h4><div class="profile-line"><b>Contact:</b> ${esc(c.emergencyContactName||'—')}</div><div class="profile-line"><b>Relationship:</b> ${esc(c.emergencyContactRelationship||'—')}</div><div class="profile-line"><b>Phone:</b> ${esc(c.emergencyContactPhone||'—')}</div><div class="profile-line"><b>Doctor:</b> ${esc(c.doctorName||'—')} ${esc(c.doctorPhone||'')}</div></div><div class="profile-card"><h4>Medical Information</h4><div class="profile-line"><b>Allergies:</b> ${esc(c.allergies||'None recorded')}</div><div class="profile-line"><b>Conditions:</b> ${esc(c.medicalConditions||'None recorded')}</div><div class="profile-line"><b>Current Medicines:</b> ${esc(c.currentMedications||'None recorded')}</div></div><div class="profile-card"><h4>Notes</h4><div class="profile-line">${esc(c.notes||'No notes')}</div></div></div><h3>Complete Medicine Purchase History</h3><div class="table-wrap history-table"><table class="data-table"><thead><tr><th>Date</th><th>Invoice</th><th>Medicine</th><th>Batch</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>${d.lines.map(l=>{const s=saleMap[l.saleId]||{};return `<tr><td>${fmtDate(s.createdUtc)}</td><td>${esc(s.invoiceNo||'')}</td><td><b>${esc(l.productName)}</b>${l.directions?`<br><small class="directions-line">${esc(l.directions)}</small>`:''}</td><td>${esc(l.batchNo)}</td><td>${l.quantity}</td><td>${money(l.unitPrice)}</td><td>${money(l.lineTotal)}</td></tr>`}).join('')||'<tr><td colspan="7" class="empty">No linked medicine purchases yet. Select this patient at POS before completing a sale.</td></tr>'}</tbody></table></div></div></div>`;document.body.appendChild(host);document.getElementById('cmClose').onclick=()=>host.remove()}catch(err){toast(err.message,'error')}}

/* PURPOSE: Render POS with patient selection so completed invoices feed patient medicine history. REFERENCE: CustomerId is saved on Sale. */
function posView(){
  const selected=appState.products.find(p=>p.id===appState.selectedProductId),productBatches=appState.batches.filter(b=>b.productId===appState.selectedProductId&&b.quantity>0&&daysLeft(b.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate)),subtotal=appState.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  return `<div class="page-header"><div><h1>POS Sales</h1><p>Fast billing with patient, batch & expiry control</p></div><span class="sync-pill">${navigator.onLine?'🟢 Online sync ready':'🟠 Offline queue ready'}</span></div>${navigator.onLine?'':'<div class="offline-banner">Offline sale mode: invoices are saved locally first and synchronized later.</div>'}<div class="pos-grid"><div class="panel product-search-panel"><div class="panel-head"><span>Find Medicine</span><span class="badge blue">F2 Search</span></div><div class="pos-search"><input id="posSearch" placeholder="Scan barcode or search medicine..."><button class="btn-primary" id="posSearchBtn">Search</button></div><div class="product-list">${appState.products.slice(0,1000).map(p=>`<div class="product-row ${p.id===appState.selectedProductId?'selected':''}" data-product-id="${p.id}"><div><b>${esc(p.name)}</b><br><small>${esc(p.genericName||'')}</small></div><div>${esc(p.strength||'')}</div><div>${money(p.sellingPrice)}</div><div>${stockForProduct(p.id)}</div></div>`).join('')}</div>${selected?`<div class="medicine-card"><img class="product-photo" src="${esc(selected.imageUrl||'/images/medicine-placeholder.svg')}" onerror="this.src='/images/medicine-placeholder.svg'"><div><b>${esc(selected.name)}</b><div class="muted">${esc(selected.category||'')} • ${esc(selected.brand||'')}</div></div></div><div class="batch-box"><b>Select Batch (FEFO)</b><div class="batch-buttons">${productBatches.map(b=>`<button class="batch-btn ${b.id===appState.selectedBatchId?'active':''}" data-batch-id="${b.id}">${esc(b.batchNo)} • ${fmtDate(b.expiryDate)} • Qty ${b.quantity}</button>`).join('')||'<span class="danger-text">No valid batch stock.</span>'}</div><div style="margin-top:10px"><button class="btn-success" id="addToCartBtn" ${appState.selectedBatchId?'':'disabled'}>+ Add Selected Batch</button></div></div>`:''}</div><div class="panel"><div class="panel-head"><span>Cart</span><button class="btn-danger btn-xs" id="clearCartBtn">Clear</button></div><div class="panel-body"><div class="patient-select"><select id="posCustomer"><option value="">Walk-in Customer</option>${appState.customers.map(c=>`<option value="${c.id}" ${Number(appState.selectedCustomerId)===c.id?'selected':''}>${esc(c.name)} — ${esc(c.phone||'')}</option>`).join('')}</select><button class="btn-light" id="quickAddPatientBtn">+ Patient</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>${appState.cart.map((l,i)=>`<tr><td>${esc(l.productName)}</td><td>${esc(l.batchNo)}</td><td>${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:70px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button> `:'' }<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Select a medicine to begin.</td></tr>'}</tbody></table></div><div class="cart-summary"><div class="sum-box">Subtotal<strong>${money(subtotal)}</strong></div><div class="sum-box">Discount<strong>${money(0)}</strong></div><div class="sum-box total-box">Total<strong>${money(subtotal)}</strong></div></div><div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div><div class="checkout-actions"><button class="btn-light" id="holdSaleBtn">Hold</button><button class="btn-light" id="printBtn">Print</button><button class="btn-success btn-lg" id="completeSaleBtn" ${appState.cart.length?'':'disabled'}>Complete Sale</button></div></div></div></div>`;
}

/* PURPOSE: Wire patient-aware POS while retaining offline-first behavior. REFERENCE: selectedCustomerId is included in queued sale. */
function bindPos(){
  const search=document.getElementById('posSearch'),filter=()=>{const q=(search?.value||'').toLowerCase();document.querySelectorAll('.product-row').forEach(row=>{const p=appState.products.find(x=>String(x.id)===row.dataset.productId);row.style.display=!q||`${p?.name} ${p?.genericName} ${p?.barcode} ${p?.rxNormId}`.toLowerCase().includes(q)?'':'none'})};search?.addEventListener('input',filter);document.getElementById('posSearchBtn')?.addEventListener('click',filter);document.querySelectorAll('[data-product-id]').forEach(row=>row.onclick=()=>{appState.selectedProductId=Number(row.dataset.productId);const first=appState.batches.filter(b=>b.productId===appState.selectedProductId&&b.quantity>0&&daysLeft(b.expiryDate)>=0).sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate))[0];appState.selectedBatchId=first?.id||null;render()});document.querySelectorAll('[data-batch-id]').forEach(btn=>btn.onclick=()=>{appState.selectedBatchId=Number(btn.dataset.batchId);render()});document.getElementById('addToCartBtn')?.addEventListener('click',addSelectedBatchToCart);document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render()});document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render()});document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{const item=appState.cart[Number(input.dataset.cartIndex)];item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));render()});document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render()});document.getElementById('posCustomer')?.addEventListener('change',e=>{appState.selectedCustomerId=e.target.value?Number(e.target.value):null});document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{if(!appState.cart.length)return toast('Cart is empty.','warning');appState.heldSales.push({id:Date.now(),cart:appState.cart,paymentMethod:appState.paymentMethod,customerId:appState.selectedCustomerId});localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));appState.cart=[];render();toast('Sale held locally.')});
}

/* PURPOSE: Complete a patient-aware sale by saving locally first, then synchronizing. REFERENCE: Offline-first transaction guarantee plus patient history linkage. */
async function completeSale(){if(!appState.cart.length)return;const opId=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`,sale={tenantId:appState.session.tenantId,branchId:appState.session.branchId,clientOperationId:opId,discount:0,paymentMethod:appState.paymentMethod,customerId:appState.selectedCustomerId||null,lines:appState.cart.map(x=>({batchId:x.batchId,quantity:x.quantity})),localCreatedUtc:new Date().toISOString(),status:'pending'};await PharmaOffline.put('pendingSales',opId,sale);for(const line of appState.cart){const b=appState.batches.find(x=>x.id===line.batchId);if(b)b.quantity=Math.max(0,Number(b.quantity)-Number(line.quantity))}await PharmaOffline.replaceAll('batches',appState.batches);appState.cart=[];appState.selectedCustomerId=null;render();toast(navigator.onLine?'Sale saved locally. Synchronizing...':'Sale saved offline. It will sync automatically.');if(navigator.onLine){await syncPendingSales();await refreshSnapshot();await loadDashboard();render()}}


/* ============================================================================
 POS BATCH POPUP
 PURPOSE:
 Opens a dedicated batch-selection modal whenever a medicine is clicked in POS.
 REFERENCE:
 Keeps batch/expiry choice out of the left medicine panel and makes FEFO selection
 clear before an item is added to the cart.
============================================================================ */

/*
 PURPOSE:
 Renders the POS medicine list and cart without an inline batch block.
 REFERENCE:
 Clicking a medicine now opens showBatchSelectionModal(productId).
*/
function posView(){
  const subtotal=appState.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  return `<div class="page-header"><div><h1>POS Sales</h1><p>Fast billing with patient, batch & expiry control</p></div><span class="sync-pill">${navigator.onLine?'🟢 Online sync ready':'🟠 Offline queue ready'}</span></div>
  ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode: invoices are saved locally first and synchronized later.</div>'}
  <div class="pos-grid">
    <div class="panel product-search-panel">
      <div class="panel-head"><span>Find Medicine</span><span class="badge blue">F2 Search</span></div>
      <div class="pos-search"><input id="posSearch" placeholder="Scan barcode or search medicine..."><button class="btn-primary" id="posSearchBtn">Search</button></div>
      <div class="product-list">${appState.products.slice(0,1000).map(p=>`
        <div class="product-row ${p.id===appState.selectedProductId?'selected':''}" data-product-id="${p.id}">
          <div><b>${esc(p.name)}</b><br><small>${esc(p.genericName||'')}</small></div>
          <div>${esc(p.strength||'')}</div>
          <div>${money(p.sellingPrice)}</div>
          <div>${stockForProduct(p.id)}</div>
        </div>`).join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><span>Cart (${appState.cart.length} items)</span><button class="btn-danger btn-xs" id="clearCartBtn">Clear All</button></div>
      <div class="panel-body">
        <div class="patient-select"><select id="posCustomer"><option value="">Walk-in Customer</option>${appState.customers.map(c=>`<option value="${c.id}" ${Number(appState.selectedCustomerId)===c.id?'selected':''}>${esc(c.name)} — ${esc(c.phone||'')}</option>`).join('')}</select><button class="btn-light" id="quickAddPatientBtn">+ Patient</button></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>
        ${appState.cart.map((l,i)=>`<tr><td><b>${esc(l.productName)}</b>${l.directions?`<br><small class="directions-line">${esc(l.directions)}</small>`:''}</td><td>${esc(l.batchNo)}</td><td>${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:70px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button> `:'' }<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Click a medicine to select its batch.</td></tr>'}
        </tbody></table></div>
        <div class="cart-summary"><div class="sum-box">Subtotal<strong>${money(subtotal)}</strong></div><div class="sum-box">Discount<strong>${money(0)}</strong></div><div class="sum-box total-box">Total<strong>${money(subtotal)}</strong></div></div>
        <div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div>
        <div class="checkout-actions"><button class="btn-light" id="holdSaleBtn">Hold</button><button class="btn-light" id="printBtn">Print</button><button class="btn-success btn-lg" id="completeSaleBtn" ${appState.cart.length?'':'disabled'}>Complete Sale</button></div>
      </div>
    </div>
  </div>`;
}

/*
 PURPOSE:
 Wires POS medicine clicks to the batch selection popup.
 REFERENCE:
 Search, cart editing, patient selection, payment and checkout remain unchanged.
*/
function bindPos(){
  const search=document.getElementById('posSearch');
  const filter=()=>{
    const q=(search?.value||'').toLowerCase();
    document.querySelectorAll('.product-row').forEach(row=>{
      const p=appState.products.find(x=>String(x.id)===row.dataset.productId);
      row.style.display=!q||`${p?.name} ${p?.genericName} ${p?.barcode} ${p?.rxNormId}`.toLowerCase().includes(q)?'':'none';
    });
  };
  search?.addEventListener('input',filter);
  document.getElementById('posSearchBtn')?.addEventListener('click',filter);
  document.querySelectorAll('[data-product-id]').forEach(row=>row.onclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });
  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });
  document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render();});
  document.getElementById('posCustomer')?.addEventListener('change',e=>{appState.selectedCustomerId=e.target.value?Number(e.target.value):null;});
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());
  document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({id:Date.now(),cart:appState.cart,paymentMethod:appState.paymentMethod,customerId:appState.selectedCustomerId});
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    render();
    toast('Sale held locally.');
  });
}

/*
 PURPOSE:
 Shows valid batches for one medicine in FEFO order inside a popup.
 REFERENCE:
 Expired/zero-stock batches are excluded; the earliest expiry is highlighted as FEFO.
*/
function showBatchSelectionModal(productId){
  const product=appState.products.find(p=>p.id===productId);
  if(!product)return;
  const batches=appState.batches
    .filter(b=>b.productId===productId && Number(b.quantity)>0 && daysLeft(b.expiryDate)>=0)
    .sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate));

  if(!batches.length){
    toast('No valid in-stock batch is available for this medicine.','warning');
    return;
  }

  let selectedBatchId=batches[0].id;
  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
  <div class="modal batch-select-modal">
    <div class="modal-head">
      <div>
        <b class="batch-modal-title">Select Batch for ${esc(product.name)}</b>
        <div class="muted">Choose the exact batch before adding this medicine to the cart.</div>
      </div>
      <button class="close-btn" id="batchModalClose">×</button>
    </div>
    <div class="modal-body">
      <div class="batch-product-summary">
        <img class="product-photo batch-product-photo" src="${esc(product.imageUrl||'/images/medicine-placeholder.svg')}" onerror="this.src='/images/medicine-placeholder.svg'">
        <div><b>${esc(product.name)}</b><div class="muted">${esc(product.category||'Medicine')} • ${esc(product.brand||product.genericName||'')}</div></div>
        <span class="badge green">${esc(product.strength||'')}</span>
      </div>
      <div class="batch-modal-table">
        <div class="batch-table-head"><span>Batch No.</span><span>Expiry Date</span><span>Available Qty</span><span>Selling Price</span><span>Select</span></div>
        ${batches.map((b,index)=>`
          <label class="batch-choice-row ${index===0?'fefo-row selected':''}" data-batch-choice="${b.id}">
            <span><b>${esc(b.batchNo)}</b>${index===0?'<small class="fefo-tag">FEFO • Earliest Expiry</small>':''}</span>
            <span><b>${fmtDate(b.expiryDate)}</b><small>${daysLeft(b.expiryDate)} days left</small></span>
            <span><b>${Number(b.quantity)}</b></span>
            <span><b>${money(b.sellingPrice)}</b></span>
            <span><input type="radio" name="batchChoice" value="${b.id}" ${index===0?'checked':''}></span>
          </label>`).join('')}
      </div>
      <div class="fefo-help"><b>FEFO (First Expiry, First Out)</b> — the earliest valid expiry is selected automatically to reduce waste and improve stock rotation.</div>
    </div>
    <div class="modal-foot batch-modal-foot">
      <div class="selected-batch-pill" id="selectedBatchSummary"></div>
      <button class="btn-light" id="batchModalCancel">Cancel</button>
      <button class="btn-primary btn-lg" id="batchModalAdd">Add to Cart</button>
    </div>
  </div>`;
  document.body.appendChild(host);

  const close=()=>host.remove();
  const updateSummary=()=>{
    const batch=batches.find(b=>b.id===selectedBatchId);
    const summary=document.getElementById('selectedBatchSummary');
    if(summary && batch)summary.textContent=`${batch.batchNo} • Exp ${fmtDate(batch.expiryDate)} • Qty ${batch.quantity}`;
    host.querySelectorAll('[data-batch-choice]').forEach(row=>row.classList.toggle('selected',Number(row.dataset.batchChoice)===selectedBatchId));
  };
  updateSummary();

  document.getElementById('batchModalClose').onclick=close;
  document.getElementById('batchModalCancel').onclick=close;
  host.querySelectorAll('input[name="batchChoice"]').forEach(radio=>radio.onchange=()=>{
    selectedBatchId=Number(radio.value);
    updateSummary();
  });
  host.querySelectorAll('[data-batch-choice]').forEach(row=>row.onclick=e=>{
    if(e.target.tagName!=='INPUT'){
      selectedBatchId=Number(row.dataset.batchChoice);
      const radio=row.querySelector('input[type="radio"]');
      if(radio)radio.checked=true;
      updateSummary();
    }
  });
  document.getElementById('batchModalAdd').onclick=()=>{
    const batch=batches.find(b=>b.id===selectedBatchId);
    close();
    showQuantityModal(product,batch);
  };
}

/*
 PURPOSE:
 Adds a popup-selected batch to the cart and respects available cached stock.
 REFERENCE:
 Existing cart lines for the same batch are incremented instead of duplicated.
*/
function addBatchToCart(product,batch){
  if(!product||!batch)return;
  const existing=appState.cart.find(x=>x.batchId===batch.id);
  if(existing){
    if(existing.quantity>=Number(batch.quantity))return toast('No more cached stock is available in this batch.','warning');
    existing.quantity+=1;
  }else{
    appState.cart.push({
      batchId:batch.id,
      productId:product.id,
      productName:product.name,
      batchNo:batch.batchNo,
      expiryDate:batch.expiryDate,
      unitPrice:Number(batch.sellingPrice),
      quantity:1,
      maxQty:Number(batch.quantity)
    });
  }
  appState.selectedBatchId=batch.id;
  toast(`${product.name} • batch ${batch.batchNo} added to cart.`,'success');
  render();
}


/* ============================================================================
 POS QUANTITY POPUP
 PURPOSE:
 Prompts for sale quantity after the cashier selects a batch.
 REFERENCE:
 Quantity is limited by available batch stock and any quantity already present
 in the cart for the same batch.
============================================================================ */

/*
 PURPOSE:
 Opens a compact quantity selector with minus/plus controls and direct numeric input.
 REFERENCE:
 Confirm adds the requested quantity to the existing cart line or creates a new line.
*/
function showQuantityModal(product,batch){
  if(!product||!batch)return;

  const existing=appState.cart.find(x=>x.batchId===batch.id);
  const alreadyInCart=Number(existing?.quantity||0);
  const available=Math.max(0,Number(batch.quantity)-alreadyInCart);

  if(available<=0){
    toast('All available stock from this batch is already in the cart.','warning');
    return;
  }

  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
    <div class="modal qty-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">Enter Quantity</b>
          <div class="muted">${esc(product.name)} • Batch ${esc(batch.batchNo)}</div>
        </div>
        <button class="close-btn" id="qtyModalClose">×</button>
      </div>
      <div class="modal-body">
        <div class="qty-stock-summary">
          <div><span>Available</span><strong>${available}</strong></div>
          <div><span>Expiry</span><strong>${fmtDate(batch.expiryDate)}</strong></div>
          <div><span>Unit Price</span><strong>${money(batch.sellingPrice)}</strong></div>
        </div>
        <div class="qty-picker">
          <button type="button" class="qty-step" id="qtyMinus">−</button>
          <input id="qtyInput" type="number" min="1" max="${available}" value="1" inputmode="numeric">
          <button type="button" class="qty-step" id="qtyPlus">+</button>
        </div>
        <div class="qty-total">Line Total: <strong id="qtyLineTotal">${money(batch.sellingPrice)}</strong></div>
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="qtyModalCancel">Cancel</button>
        <button class="btn-success btn-lg" id="qtyModalConfirm">Confirm Add to Cart</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const input=document.getElementById('qtyInput');
  const close=()=>host.remove();

  const normalize=()=>{
    let value=Math.floor(Number(input.value)||1);
    value=Math.max(1,Math.min(available,value));
    input.value=String(value);
    const total=document.getElementById('qtyLineTotal');
    if(total)total.textContent=money(value*Number(batch.sellingPrice));
    return value;
  };

  document.getElementById('qtyModalClose').onclick=close;
  document.getElementById('qtyModalCancel').onclick=close;
  document.getElementById('qtyMinus').onclick=()=>{input.value=String(normalize()-1);normalize();};
  document.getElementById('qtyPlus').onclick=()=>{input.value=String(normalize()+1);normalize();};
  input.oninput=normalize;
  input.onkeydown=e=>{
    if(e.key==='Enter')document.getElementById('qtyModalConfirm').click();
  };
  document.getElementById('qtyModalConfirm').onclick=()=>{
    const qty=normalize();
    addBatchToCart(product,batch,qty);
    close();
  };
  setTimeout(()=>{input.focus();input.select();},0);
}

/*
 PURPOSE:
 Adds a chosen quantity for a batch to the cart.
 REFERENCE:
 Existing cart lines are incremented and never exceed current cached batch stock.
*/
function addBatchToCart(product,batch,quantity=1){
  if(!product||!batch)return;

  const requested=Math.max(1,Math.floor(Number(quantity)||1));
  const existing=appState.cart.find(x=>x.batchId===batch.id);
  const current=Number(existing?.quantity||0);
  const maxQty=Number(batch.quantity);

  if(current+requested>maxQty){
    toast(`Only ${Math.max(0,maxQty-current)} more unit(s) are available in this batch.`,'warning');
    return;
  }

  if(existing){
    existing.quantity+=requested;
  }else{
    appState.cart.push({
      batchId:batch.id,
      productId:product.id,
      productName:product.name,
      batchNo:batch.batchNo,
      expiryDate:batch.expiryDate,
      unitPrice:Number(batch.sellingPrice),
      quantity:requested,
      maxQty:maxQty
    });
  }

  appState.selectedBatchId=batch.id;
  toast(`${requested} × ${product.name} • batch ${batch.batchNo} added to cart.`,'success');
  render();
}


/* ============================================================================
 PRODUCT DIRECTIONS / DISPENSING LABEL WORKFLOW
 PURPOSE:
 Lets a pharmacist mark a medicine so POS asks for authorized directions after
 quantity selection and can print those directions on a small dispensing label.
 REFERENCE:
 Direction templates are convenience text only. They do not calculate or
 recommend a dose and must match the prescription or pharmacist-authorized use.
============================================================================ */

const DIRECTIONS_META_START='[[PHARMACARE_DIRECTIONS]]';
const DIRECTIONS_META_END='[[/PHARMACARE_DIRECTIONS]]';

/*
 PURPOSE:
 Reads the hidden directions settings stored inside Product.Notes while returning
 the pharmacist's normal free-text notes separately.
 REFERENCE:
 Reusing Product.Notes avoids forcing an MSSQL schema reset for this feature.
*/
function parseProductNotes(rawNotes){
  const raw=String(rawNotes||'');
  const start=raw.indexOf(DIRECTIONS_META_START);
  const end=raw.indexOf(DIRECTIONS_META_END);
  if(start<0||end<0||end<start){
    return {enabled:false,defaultDirections:'',userNotes:raw};
  }
  let meta={};
  try{
    const json=raw.slice(start+DIRECTIONS_META_START.length,end);
    meta=JSON.parse(json);
  }catch{}
  const before=raw.slice(0,start);
  const after=raw.slice(end+DIRECTIONS_META_END.length);
  return {
    enabled:Boolean(meta.enabled),
    defaultDirections:String(meta.defaultDirections||''),
    userNotes:(before+after).trim()
  };
}

/*
 PURPOSE:
 Combines normal product notes with the directions settings in one database field.
 REFERENCE:
 The metadata block remains readable JSON and does not affect existing APIs.
*/
function buildProductNotes(userNotes,enabled,defaultDirections){
  const meta=JSON.stringify({
    enabled:Boolean(enabled),
    defaultDirections:String(defaultDirections||'').trim()
  });
  const notes=String(userNotes||'').trim();
  return `${DIRECTIONS_META_START}${meta}${DIRECTIONS_META_END}${notes?'\n'+notes:''}`;
}

/*
 PURPOSE:
 Returns whether POS should prompt for directions for a product.
 REFERENCE:
 Imported/older products without metadata simply return disabled.
*/
function productDirectionsSettings(product){
  return parseProductNotes(product?.notes||'');
}

/*
 PURPOSE:
 Opens a clean New/Edit Product form with an optional POS directions-label setting.
 REFERENCE:
 The directions setting is stored inside Product.Notes so the current MSSQL schema
 remains compatible.
*/
function showProductModal(product = null) {
  const directionInfo=productDirectionsSettings(product);
  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
  <div class="modal wide">
    <div class="modal-head">
      <b>${product?'Edit Medicine':'New Medicine Item'}</b>
      <button class="close-btn" id="closeProductModal">×</button>
    </div>
    <form id="productForm">
      <div class="modal-body">
        <div class="form-grid">
          <div class="field"><label>Product Name *</label><input id="pName" required value="${esc(product?.name||'')}"></div>
          <div class="field"><label>Generic Name</label><input id="pGeneric" value="${esc(product?.genericName||'')}"></div>
          <div class="field"><label>Strength</label><input id="pStrength" value="${esc(product?.strength||'')}"></div>
          <div class="field"><label>Dosage Form</label><input id="pDosageForm" placeholder="Tablet, capsule, syrup..." value="${esc(product?.dosageForm||'')}"></div>
          <div class="field"><label>Pack Size</label><input id="pPack" value="${esc(product?.packSize||'')}"></div>
          <div class="field"><label>Category</label><input id="pCategory" value="${esc(product?.category||'')}"></div>
          <div class="field"><label>Brand</label><input id="pBrand" value="${esc(product?.brand||'')}"></div>
          <div class="field"><label>Manufacturer</label><input id="pManufacturer" value="${esc(product?.manufacturer||'')}"></div>
          <div class="field"><label>Barcode</label><input id="pBarcode" value="${esc(product?.barcode||'')}"></div>
          <div class="field"><label>RxNorm ID</label><input id="pRxNorm" value="${esc(product?.rxNormId||'')}"></div>
          <div class="field"><label>Purchase Price</label><input id="pCost" type="number" step="0.01" min="0" value="${product?.purchasePrice??0}"></div>
          <div class="field"><label>Selling Price</label><input id="pSell" type="number" step="0.01" min="0" value="${product?.sellingPrice??0}"></div>
          <div class="field full"><label>Photo URL</label><input id="pImage" placeholder="https://... or /images/..." value="${esc(product?.imageUrl||'/images/medicine-placeholder.svg')}"></div>

          <div class="field full directions-product-box">
            <label class="check-row">
              <input id="pDirectionsEnabled" type="checkbox" ${directionInfo.enabled?'checked':''}>
              <span><b>Ask for / print directions to use at POS</b><small>After quantity is entered, show a “How to Use” screen before adding to cart.</small></span>
            </label>
            <div class="field" style="margin:10px 0 0">
              <label>Default Directions (optional)</label>
              <input id="pDefaultDirections" placeholder="Example: Take 1 at night" value="${esc(directionInfo.defaultDirections)}" ${directionInfo.enabled?'':'disabled'}>
            </div>
          </div>

          <div class="field full"><label>Notes</label><input id="pNotes" value="${esc(directionInfo.userNotes)}"></div>
          <div class="field"><label><input id="pTrack" type="checkbox" ${product?.trackBatchExpiry===false?'':'checked'} style="width:auto"> Track Batch & Expiry</label></div>
          <div class="field"><label><input id="pRx" type="checkbox" ${product?.requiresPrescription?'checked':''} style="width:auto"> Requires Prescription</label></div>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn-light" id="cancelProduct">Cancel</button>
        <button class="btn-success" type="submit">Save Medicine</button>
      </div>
    </form>
  </div>`;
  document.body.appendChild(host);

  const close=()=>host.remove();
  const enabled=document.getElementById('pDirectionsEnabled');
  const defaultInput=document.getElementById('pDefaultDirections');

  document.getElementById('closeProductModal').onclick=close;
  document.getElementById('cancelProduct').onclick=close;
  enabled.onchange=()=>{
    defaultInput.disabled=!enabled.checked;
    if(enabled.checked)defaultInput.focus();
  };

  document.getElementById('productForm').onsubmit=async e=>{
    e.preventDefault();
    if(!navigator.onLine)return toast('Saving a medicine requires internet.','warning');

    const body={
      tenantId:appState.session.tenantId,
      name:document.getElementById('pName').value.trim(),
      genericName:document.getElementById('pGeneric').value.trim(),
      strength:document.getElementById('pStrength').value.trim(),
      dosageForm:document.getElementById('pDosageForm').value.trim(),
      packSize:document.getElementById('pPack').value.trim(),
      category:document.getElementById('pCategory').value.trim(),
      brand:document.getElementById('pBrand').value.trim(),
      manufacturer:document.getElementById('pManufacturer').value.trim(),
      barcode:document.getElementById('pBarcode').value.trim(),
      rxNormId:document.getElementById('pRxNorm').value.trim(),
      imageUrl:document.getElementById('pImage').value.trim(),
      notes:buildProductNotes(
        document.getElementById('pNotes').value.trim(),
        enabled.checked,
        defaultInput.value.trim()
      ),
      sellingPrice:Number(document.getElementById('pSell').value||0),
      purchasePrice:Number(document.getElementById('pCost').value||0),
      trackBatchExpiry:document.getElementById('pTrack').checked,
      requiresPrescription:document.getElementById('pRx').checked
    };

    try{
      await api(product?`/api/products/${product.id}`:'/api/products',{
        method:product?'PUT':'POST',
        body:JSON.stringify(body)
      });
      await refreshSnapshot();
      close();
      render();
      toast('Medicine saved.');
    }catch(err){
      toast(err.message,'error');
    }
  };
}

/*
 PURPOSE:
 Replaces the quantity-confirm action so products marked for directions open the
 How to Use popup before entering the cart.
 REFERENCE:
 Products without the setting enabled continue directly to Add to Cart.
*/
function showQuantityModal(product,batch){
  if(!product||!batch)return;

  const existing=appState.cart.filter(x=>x.batchId===batch.id)
    .reduce((sum,x)=>sum+Number(x.quantity||0),0);
  const available=Math.max(0,Number(batch.quantity)-existing);

  if(available<=0){
    toast('All available stock from this batch is already in the cart.','warning');
    return;
  }

  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
    <div class="modal qty-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">Enter Quantity</b>
          <div class="muted">${esc(product.name)} • Batch ${esc(batch.batchNo)}</div>
        </div>
        <button class="close-btn" id="qtyModalClose">×</button>
      </div>
      <div class="modal-body">
        <div class="qty-stock-summary">
          <div><span>Available</span><strong>${available}</strong></div>
          <div><span>Expiry</span><strong>${fmtDate(batch.expiryDate)}</strong></div>
          <div><span>Unit Price</span><strong>${money(batch.sellingPrice)}</strong></div>
        </div>
        <div class="qty-picker">
          <button type="button" class="qty-step" id="qtyMinus">−</button>
          <input id="qtyInput" type="number" min="1" max="${available}" value="1" inputmode="numeric">
          <button type="button" class="qty-step" id="qtyPlus">+</button>
        </div>
        <div class="qty-total">Line Total: <strong id="qtyLineTotal">${money(batch.sellingPrice)}</strong></div>
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="qtyModalCancel">Cancel</button>
        <button class="btn-success btn-lg" id="qtyModalConfirm">Continue</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const input=document.getElementById('qtyInput');
  const close=()=>host.remove();
  const normalize=()=>{
    let value=Math.floor(Number(input.value)||1);
    value=Math.max(1,Math.min(available,value));
    input.value=String(value);
    const total=document.getElementById('qtyLineTotal');
    if(total)total.textContent=money(value*Number(batch.sellingPrice));
    return value;
  };

  document.getElementById('qtyModalClose').onclick=close;
  document.getElementById('qtyModalCancel').onclick=close;
  document.getElementById('qtyMinus').onclick=()=>{input.value=String(normalize()-1);normalize();};
  document.getElementById('qtyPlus').onclick=()=>{input.value=String(normalize()+1);normalize();};
  input.oninput=normalize;
  input.onkeydown=e=>{if(e.key==='Enter')document.getElementById('qtyModalConfirm').click();};
  document.getElementById('qtyModalConfirm').onclick=()=>{
    const qty=normalize();
    const settings=productDirectionsSettings(product);
    close();
    if(settings.enabled){
      showDirectionsModal(product,batch,qty,settings.defaultDirections);
    }else{
      addBatchToCart(product,batch,qty,'');
    }
  };
  setTimeout(()=>{input.focus();input.select();},0);
}

/*
 PURPOSE:
 Shows authorized direction templates after quantity selection.
 REFERENCE:
 Templates are examples only; the pharmacist must ensure the text matches the
 prescription or authorized directions for that patient and medicine.
*/
function showDirectionsModal(product,batch,quantity,defaultDirections=''){
  const templates=getDirectionTemplates();

  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
    <div class="modal directions-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">How to Use</b>
          <div class="muted">${esc(product.name)} • Qty ${quantity} • Batch ${esc(batch.batchNo)}</div>
        </div>
        <button class="close-btn" id="directionsClose">×</button>
      </div>
      <div class="modal-body">
        <div class="directions-warning">
          <b>Use the prescription / authorized directions.</b>
          The buttons below are text templates only and do not determine the correct dose.
        </div>
        <label class="directions-label">Quick Directions</label>
        <div class="direction-template-grid">
          ${templates.map(text=>`<button type="button" class="direction-template" data-direction-template="${esc(text)}">${esc(text)}</button>`).join('')}
        </div>
        <div class="field">
          <label>Directions to Print</label>
          <textarea id="directionsText" rows="3" placeholder="Enter the exact authorized directions...">${esc(defaultDirections)}</textarea>
        </div>
        <label class="check-row print-directions-check">
          <input id="printDirectionsNow" type="checkbox" ${getPrinterSettings().autoPrintLabel?'checked':''}>
          <span><b>Print directions label after adding to cart</b><small>You can also reprint the label from the cart.</small></span>
        </label>
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="directionsBack">Back</button>
        <button class="btn-light" id="directionsCancel">Cancel</button>
        <button class="btn-success btn-lg" id="directionsConfirm">Add to Cart</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const textarea=document.getElementById('directionsText');
  const close=()=>host.remove();

  document.getElementById('directionsClose').onclick=close;
  document.getElementById('directionsCancel').onclick=close;
  document.getElementById('directionsBack').onclick=()=>{
    close();
    showQuantityModal(product,batch);
  };

  host.querySelectorAll('[data-direction-template]').forEach(btn=>btn.onclick=()=>{
    textarea.value=btn.dataset.directionTemplate;
    textarea.focus();
  });

  document.getElementById('directionsConfirm').onclick=()=>{
    const directions=textarea.value.trim();
    if(!directions){
      toast('Enter the authorized directions to use.','warning');
      textarea.focus();
      return;
    }

    const shouldPrint=document.getElementById('printDirectionsNow').checked;
    const line=addBatchToCart(product,batch,quantity,directions);
    if(!line)return;
    close();

    if(shouldPrint){
      printDirectionLabel(line);
    }
  };

  setTimeout(()=>{textarea.focus();textarea.select();},0);
}

/*
 PURPOSE:
 Adds the selected quantity and directions to the cart.
 REFERENCE:
 Lines with different directions are kept separate even when they use the same batch.
*/
function addBatchToCart(product,batch,quantity=1,directions=''){
  if(!product||!batch)return null;

  const requested=Math.max(1,Math.floor(Number(quantity)||1));
  const normalizedDirections=String(directions||'').trim();
  const selectedPatient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const patientFullName=selectedPatient?.name?.trim()||'';

  const totalAlreadyInCart=appState.cart
    .filter(x=>x.batchId===batch.id)
    .reduce((sum,x)=>sum+Number(x.quantity||0),0);

  const maxQty=Number(batch.quantity);
  if(totalAlreadyInCart+requested>maxQty){
    toast(`Only ${Math.max(0,maxQty-totalAlreadyInCart)} more unit(s) are available in this batch.`,'warning');
    return null;
  }

  let line=appState.cart.find(x=>
    x.batchId===batch.id &&
    String(x.directions||'').trim()===normalizedDirections &&
    String(x.patientName||'').trim()===patientFullName
  );

  if(line){
    line.quantity+=requested;
  }else{
    line={
      batchId:batch.id,
      productId:product.id,
      productName:product.name,
      batchNo:batch.batchNo,
      expiryDate:batch.expiryDate,
      unitPrice:Number(batch.sellingPrice),
      quantity:requested,
      maxQty:maxQty,
      directions:normalizedDirections,
      patientId:selectedPatient?.id||null,
      patientName:patientFullName
    };
    appState.cart.push(line);
  }

  appState.selectedBatchId=batch.id;
  toast(`${requested} × ${product.name} • batch ${batch.batchNo} added to cart.`,'success');
  render();
  return line;
}

/*
 PURPOSE:
 Prints a compact medicine directions label from a cart line.
 REFERENCE:
 Browser print is used so no printer SDK is required; a label printer can be
 selected in the normal print dialog.
*/
function printDirectionLabel(line){
  if(!line?.directions){
    toast('This cart line has no directions to print.','warning');
    return;
  }

  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'Pharmacy';
  const printWindow=window.open('','_blank','width=720,height=520');
  if(!printWindow){
    toast('Popup blocked. Allow popups to print the directions label.','warning');
    return;
  }

  const html=`<!doctype html>
  <html><head><meta charset="utf-8"><title>Directions Label</title>
  <style>
    @page{size:4in 2in;margin:.12in}
    body{font-family:Arial,sans-serif;margin:0;color:#111}
    .label{border:1.5px solid #111;padding:10px;height:1.7in;box-sizing:border-box}
    .pharmacy{font-size:15px;font-weight:800;border-bottom:1px solid #333;padding-bottom:4px;margin-bottom:6px}
    .patient-name{font-size:16px;font-weight:900;margin:4px 0 6px;border-bottom:1px solid #aaa;padding-bottom:4px}
    .drug{font-size:16px;font-weight:800}
    .meta{font-size:10px;margin:3px 0;color:#333}
    .directions{font-size:17px;font-weight:800;line-height:1.25;margin-top:8px}
    .footer{font-size:9px;margin-top:8px}
  </style></head><body>
    <div class="label">
      <div class="pharmacy">${esc(pharmacy)}</div>
      <div class="patient-name">Patient: ${esc(patientFullName||'Walk-in Customer')}</div>
      <div class="drug">${esc(line.productName)}</div>
      <div class="meta">Batch: ${esc(line.batchNo)} • Exp: ${fmtDate(line.expiryDate)} • Qty: ${line.quantity}</div>
      <div class="directions">${esc(line.directions)}</div>
      <div class="footer">Use exactly as prescribed / authorized. Keep out of reach of children.</div>
    </div>
    <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),400)};<\/script>
  </body></html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}


/* ============================================================================
 SETTINGS > DIRECTIONS
 PURPOSE:
 Stores pharmacy-specific quick-direction text templates used by the POS How to Use
 popup without requiring a database schema change.
 REFERENCE:
 Templates are text conveniences only; they are not dose recommendations.
============================================================================ */

/*
 PURPOSE:
 Returns the default starter direction templates.
 REFERENCE:
 Reset Default Directions restores exactly this list.
*/
function defaultDirectionTemplates(){
  return [
    'Take 1 at night',
    'Take 1 once daily',
    'Take 1 three times daily',
    'Take 1 every 3 hours',
    'Take 1 in the morning',
    'Take 1 twice daily'
  ];
}

/*
 PURPOSE:
 Builds a tenant-specific browser storage key.
 REFERENCE:
 Different pharmacy tenants using the same browser do not share direction lists.
*/
function directionTemplateStorageKey(){
  return `pharmacare.directionTemplates.${appState.session?.tenantId||'default'}`;
}

/*
 PURPOSE:
 Reads saved Settings > Directions templates.
 REFERENCE:
 Older installations automatically receive the default list on first use.
*/
function getDirectionTemplates(){
  try{
    const stored=JSON.parse(localStorage.getItem(directionTemplateStorageKey())||'null');
    if(Array.isArray(stored)){
      return stored.map(x=>String(x||'').trim()).filter(Boolean);
    }
  }catch{}
  return defaultDirectionTemplates();
}

/*
 PURPOSE:
 Persists the current quick-direction list for this tenant.
 REFERENCE:
 The POS reads the same list immediately without requiring a page reload.
*/
function saveDirectionTemplates(templates){
  const cleaned=(templates||[]).map(x=>String(x||'').trim()).filter(Boolean);
  localStorage.setItem(directionTemplateStorageKey(),JSON.stringify(cleaned));
}


/* ============================================================================
 SETTINGS > PRINTERS + DIRECT PRINT
 PURPOSE:
 Stores separate receipt and medicine-label printer settings and sends print jobs
 directly through QZ Tray when available. Browser print remains the safe fallback.
 REFERENCE:
 QZ Tray exposes qz.websocket.connect(), qz.printers.find(), qz.configs.create()
 and qz.print() for local printer access.
============================================================================ */

/* PURPOSE: Returns default printer settings for this tenant/browser. */
function defaultPrinterSettings(){
  return {mode:'browser',billPrinter:'',labelPrinter:'',billWidth:80,labelSize:'4x2',autoPrintBill:false,autoPrintLabel:false};
}

/* PURPOSE: Tenant-specific local storage key for printer preferences. */
function printerSettingsStorageKey(){
  return `pharmacare.printerSettings.${appState.session?.tenantId||'default'}`;
}

/* PURPOSE: Loads saved bill/label printer settings. */
function getPrinterSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(printerSettingsStorageKey())||'null');
    return {...defaultPrinterSettings(),...(saved||{})};
  }catch{
    return defaultPrinterSettings();
  }
}

/* PURPOSE: Saves bill/label printer settings. */
function savePrinterSettings(settings){
  localStorage.setItem(printerSettingsStorageKey(),JSON.stringify({...defaultPrinterSettings(),...settings}));
}

/* PURPOSE: Reads current Settings > Printers form values. */
function readPrinterSettingsFromForm(){
  return {
    mode:document.getElementById('printerMode')?.value||'browser',
    billPrinter:document.getElementById('billPrinterName')?.value.trim()||'',
    labelPrinter:document.getElementById('labelPrinterName')?.value.trim()||'',
    billWidth:Number(document.getElementById('billPaperWidth')?.value||80),
    labelSize:document.getElementById('labelSize')?.value||'4x2',
    autoPrintBill:Boolean(document.getElementById('autoPrintBill')?.checked),
    autoPrintLabel:Boolean(document.getElementById('autoPrintLabel')?.checked)
  };
}

/* PURPOSE: Connects to QZ Tray and returns installed printer names. */
async function detectQzPrinters(){
  if(!window.qz)throw new Error('QZ Tray JavaScript bridge is unavailable. Install/run QZ Tray and check internet access for the QZ script.');
  if(!qz.websocket.isActive())await qz.websocket.connect({retries:2,delay:1});
  return await qz.printers.find();
}

/*
 PURPOSE:
 Sends HTML to the configured printer. In browser mode it opens a standard print
 window. In QZ mode it targets the exact saved printer name.
*/
async function printHtmlToConfiguredPrinter(kind,html,isTest=false){
  const ps=getPrinterSettings();
  const printerName=kind==='label'?ps.labelPrinter:ps.billPrinter;

  if(ps.mode==='qz'){
    if(!printerName){
      toast(`Set the ${kind==='label'?'label':'bill'} printer name in Settings → Printers.`,'warning');
      return false;
    }
    try{
      if(!window.qz)throw new Error('QZ Tray bridge not loaded.');
      if(!qz.websocket.isActive())await qz.websocket.connect({retries:2,delay:1});
      const found=await qz.printers.find(printerName);
      const options=kind==='label'
        ? {units:'in',size:labelSizeToInches(ps.labelSize),margins:0}
        : {units:'mm',size:{width:Number(ps.billWidth||80),height:297},margins:0};
      const config=qz.configs.create(found,options);
      await qz.print(config,[{type:'pixel',format:'html',flavor:'plain',data:html}]);
      if(isTest)toast(`Test sent to ${found}.`);
      return true;
    }catch(e){
      toast(`Direct print failed: ${e.message}. Falling back to browser print.`,'warning');
    }
  }

  return openBrowserPrintWindow(html,kind);
}

/* PURPOSE: Converts configured label preset to QZ inches. */
function labelSizeToInches(value){
  if(value==='3x2')return {width:3,height:2};
  if(value==='2x1')return {width:2,height:1};
  return {width:4,height:2};
}

/* PURPOSE: Browser fallback print window when direct printing is unavailable. */
function openBrowserPrintWindow(html,kind){
  const w=window.open('','_blank','width=760,height=620');
  if(!w){toast('Popup blocked. Allow popups to print.','warning');return false;}
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload=()=>{w.print();};
  return true;
}

/* PURPOSE: Builds the current cart as a compact receipt for the bill printer. */
function buildBillHtml(cart=appState.cart){
  const ps=getPrinterSettings();
  const width=Number(ps.billWidth||80);
  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'Pharmacy';
  const total=cart.reduce((sum,l)=>sum+Number(l.quantity)*Number(l.unitPrice),0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:${width}mm auto;margin:2mm}
  body{font-family:Arial,sans-serif;width:${Math.max(48,width-4)}mm;margin:0;font-size:11px;color:#111}
  h2{text-align:center;margin:0 0 4px}.center{text-align:center}.line{border-top:1px dashed #333;margin:6px 0}
  table{width:100%;border-collapse:collapse}th,td{padding:3px 0;text-align:left;vertical-align:top}td.r,th.r{text-align:right}
  .total{font-size:15px;font-weight:800}.small{font-size:9px}
  </style></head><body>
  <h2>${esc(pharmacy)}</h2><div class="center small">${new Date().toLocaleString()}</div>
  ${patient?`<div class="small">Patient: ${esc(patient.name)}</div>`:''}<div class="line"></div>
  <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amt</th></tr></thead><tbody>
  ${cart.map(l=>`<tr><td>${esc(l.productName)}<div class="small">Batch ${esc(l.batchNo)}</div></td><td class="r">${l.quantity}</td><td class="r">${money(Number(l.quantity)*Number(l.unitPrice))}</td></tr>`).join('')}
  </tbody></table><div class="line"></div><div class="total">TOTAL <span style="float:right">${money(total)}</span></div>
  <div class="line"></div><div class="center small">Thank you</div></body></html>`;
}

/* PURPOSE: Prints current cart to configured bill printer. */
async function printCurrentBill(){
  if(!appState.cart.length)return toast('Cart is empty.','warning');
  await printHtmlToConfiguredPrinter('bill',buildBillHtml());
}

/* PURPOSE: Test receipt content for Settings > Printers. */
function buildTestBillHtml(){
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:2mm}body{font-family:Arial,sans-serif;font-size:12px;text-align:center}h2{margin:0}.line{border-top:1px dashed #333;margin:8px 0}</style></head><body><h2>PharmaCare POS</h2><div>Bill Printer Test</div><div class="line"></div><b>Printer setup is working</b><div>${new Date().toLocaleString()}</div></body></html>`;
}

/* PURPOSE: Test label content for Settings > Printers. */
function buildTestLabelHtml(){
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:4in 2in;margin:.1in}body{font-family:Arial,sans-serif;margin:0}.label{border:1px solid #111;padding:10px}.title{font-size:18px;font-weight:800}.directions{font-size:16px;font-weight:800;margin-top:10px}</style></head><body><div class="label"><div class="title">PharmaCare POS</div><div>Label Printer Test</div><div class="directions">Take as directed</div></div></body></html>`;
}

/*
 PURPOSE:
 Completes the sale and optionally prints the bill automatically before the cart is
 cleared from memory.
 REFERENCE:
 Sale remains offline-first; printing is a separate local side effect.
*/
async function completeSale(){
  if(!appState.cart.length)return;

  const printCart=appState.cart.map(x=>({...x}));
  const printCustomerId=appState.selectedCustomerId||null;
  const opId=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;
  const sale={
    tenantId:appState.session.tenantId,
    branchId:appState.session.branchId,
    clientOperationId:opId,
    discount:0,
    paymentMethod:appState.paymentMethod,
    customerId:printCustomerId,
    lines:appState.cart.map(x=>({batchId:x.batchId,quantity:x.quantity})),
    localCreatedUtc:new Date().toISOString(),
    status:'pending'
  };

  await PharmaOffline.put('pendingSales',opId,sale);
  for(const line of appState.cart){
    const b=appState.batches.find(x=>x.id===line.batchId);
    if(b)b.quantity=Math.max(0,Number(b.quantity)-Number(line.quantity));
  }
  await PharmaOffline.replaceAll('batches',appState.batches);

  const ps=getPrinterSettings();
  if(ps.autoPrintBill){
    const oldCustomerId=appState.selectedCustomerId;
    appState.selectedCustomerId=printCustomerId;
    await printHtmlToConfiguredPrinter('bill',buildBillHtml(printCart));
    appState.selectedCustomerId=oldCustomerId;
  }

  appState.cart=[];
  appState.selectedCustomerId=null;
  render();
  toast(navigator.onLine?'Sale saved locally. Synchronizing...':'Sale saved offline. It will sync automatically.');

  if(navigator.onLine){
    await syncPendingSales();
    await refreshSnapshot();
    await loadDashboard();
    render();
  }
}


/*
 PURPOSE:
 Builds a medicine directions label and sends it to the configured Label Printer.
 REFERENCE:
 Direct mode uses QZ Tray; browser mode opens the normal print dialog.
*/
async function printDirectionLabel(line){
  if(!line?.directions){
    toast('This cart line has no directions to print.','warning');
    return;
  }

  /*
   PURPOSE:
   Uses the patient full name saved with the cart line so a label reprint cannot
   accidentally switch to a different patient selected later in POS.
   REFERENCE:
   Older cart lines fall back to the currently selected patient for compatibility.
  */
  const fallbackPatient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const patientFullName=String(line.patientName||fallbackPatient?.name||'').trim();
  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'Pharmacy';
  const ps=getPrinterSettings();
  const size=labelSizeToInches(ps.labelSize);
  const html=`<!doctype html>
  <html><head><meta charset="utf-8"><title>Directions Label</title>
  <style>
    @page{size:${size.width}in ${size.height}in;margin:.1in}
    body{font-family:Arial,sans-serif;margin:0;color:#111}
    .label{border:1.5px solid #111;padding:10px;box-sizing:border-box;min-height:${Math.max(0.8,size.height-.2)}in}
    .pharmacy{font-size:15px;font-weight:800;border-bottom:1px solid #333;padding-bottom:4px;margin-bottom:6px}
    .drug{font-size:16px;font-weight:800}
    .meta{font-size:10px;margin:3px 0;color:#333}
    .directions{font-size:17px;font-weight:800;line-height:1.25;margin-top:8px}
    .footer{font-size:9px;margin-top:8px}
  </style></head><body>
    <div class="label">
      <div class="pharmacy">${esc(pharmacy)}</div>
      <div class="drug">${esc(line.productName)}</div>
      <div class="meta">${patient?`Patient: ${esc(patient.name)} • `:''}Batch: ${esc(line.batchNo)} • Exp: ${fmtDate(line.expiryDate)} • Qty: ${line.quantity}</div>
      <div class="directions">${esc(line.directions)}</div>
      <div class="footer">Use exactly as prescribed / authorized. Keep out of reach of children.</div>
    </div>
  </body></html>`;

  await printHtmlToConfiguredPrinter('label',html);
}


/* ============================================================================
 POS BARCODE SCANNING
 PURPOSE:
 Makes a scanner behave like a real checkout input. Barcode scanners normally
 type the code into the focused field and finish with Enter.
 REFERENCE:
 Exact barcode matches bypass text-search filtering and continue directly into
 the batch/quantity dispensing flow.
============================================================================ */

/*
 PURPOSE:
 Finds an exact product barcode and opens the shortest safe dispensing flow.
 REFERENCE:
 One valid batch goes straight to quantity. Multiple valid batches require the
 cashier to choose a batch. Expired and zero-stock batches are never selected.
*/
function handlePosBarcodeScan(rawBarcode){
  const barcode=String(rawBarcode||'').trim();
  if(!barcode)return false;

  const product=appState.products.find(p=>
    String(p.barcode||'').trim().toLowerCase()===barcode.toLowerCase()
  );

  if(!product){
    toast(`Barcode not found: ${barcode}`,'warning');
    return false;
  }

  const validBatches=appState.batches
    .filter(b=>b.productId===product.id && Number(b.quantity)>0 && daysLeft(b.expiryDate)>=0)
    .sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate));

  appState.selectedProductId=product.id;

  if(!validBatches.length){
    toast(`${product.name} was found, but it has no valid in-stock batch.`,'warning');
    return true;
  }

  appState.selectedBatchId=validBatches[0].id;

  if(validBatches.length===1){
    showQuantityModal(product,validBatches[0]);
  }else{
    showBatchSelectionModal(product.id);
  }
  return true;
}

/*
 PURPOSE:
 Wires barcode Enter handling while preserving normal medicine text search.
 REFERENCE:
 Search button filters the product list; scanner Enter first checks for an exact
 barcode match and only falls back to normal filtering when no exact barcode exists.
*/
function bindPos(){
  const search=document.getElementById('posSearch');

  const filter=()=>{
    const q=(search?.value||'').toLowerCase();
    document.querySelectorAll('.product-row').forEach(row=>{
      const p=appState.products.find(x=>String(x.id)===row.dataset.productId);
      row.style.display=!q||`${p?.name} ${p?.genericName} ${p?.barcode} ${p?.rxNormId}`.toLowerCase().includes(q)?'':'none';
    });
  };

  search?.addEventListener('input',filter);

  search?.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    e.preventDefault();

    const scanned=String(search.value||'').trim();
    const exact=appState.products.some(p=>
      String(p.barcode||'').trim().toLowerCase()===scanned.toLowerCase()
    );

    if(exact){
      handlePosBarcodeScan(scanned);
      search.value='';
      filter();
      return;
    }

    filter();
    toast(scanned?`No exact barcode match for ${scanned}.`:'Scan or enter a barcode.','warning');
    search.select();
  });

  document.getElementById('posSearchBtn')?.addEventListener('click',()=>{
    const value=String(search?.value||'').trim();
    const exact=appState.products.some(p=>
      String(p.barcode||'').trim().toLowerCase()===value.toLowerCase()
    );

    if(exact){
      handlePosBarcodeScan(value);
      if(search)search.value='';
      filter();
    }else{
      filter();
    }
  });

  document.querySelectorAll('[data-product-id]').forEach(row=>row.onclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });

  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });
  document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render();});
  document.getElementById('posCustomer')?.addEventListener('change',e=>{appState.selectedCustomerId=e.target.value?Number(e.target.value):null;});
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));
  document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());
  document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({
      id:Date.now(),
      cart:appState.cart,
      paymentMethod:appState.paymentMethod,
      customerId:appState.selectedCustomerId
    });
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    render();
    toast('Sale held locally.');
  });

  /*
   PURPOSE:
   Keeps the barcode field ready for the next scan when POS first opens.
   REFERENCE:
   Most USB barcode scanners emulate keyboard input.
  */
  setTimeout(()=>search?.focus(),0);
}


/* ============================================================================
 POS CUSTOMER LOOKUP — v5.3
 PURPOSE:
 Adds a dedicated customer/patient lookup inside POS Sales.
 REFERENCE:
 Cashiers can search by patient name, phone, email, or patient ID, review key
 pharmacy alerts, select the patient, or return to Walk-in Customer.
============================================================================ */

/*
 PURPOSE:
 Renders the POS with a visible Customer Lookup action and selected-patient summary.
 REFERENCE:
 The medicine/barcode/cart workflow remains unchanged.
*/
function posView(){
  const subtotal=appState.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));

  return `<div class="page-header"><div><h1>POS Sales</h1><p>Fast billing with patient, batch & expiry control</p></div><span class="sync-pill">${navigator.onLine?'🟢 Online sync ready':'🟠 Offline queue ready'}</span></div>
  ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode: invoices are saved locally first and synchronized later.</div>'}
  <div class="pos-grid">
    <div class="panel product-search-panel">
      <div class="panel-head"><span>Find Medicine</span><span class="badge blue">F2 Search</span></div>
      <div class="pos-search"><input id="posSearch" placeholder="Scan barcode or search medicine..."><button class="btn-primary" id="posSearchBtn">Search</button></div>
      <div class="product-list">${appState.products.slice(0,1000).map(p=>`
        <div class="product-row ${p.id===appState.selectedProductId?'selected':''}" data-product-id="${p.id}">
          <div><b>${esc(p.name)}</b><br><small>${esc(p.genericName||'')}</small></div>
          <div>${esc(p.strength||'')}</div>
          <div>${money(p.sellingPrice)}</div>
          <div>${stockForProduct(p.id)}</div>
        </div>`).join('')}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><span>Cart (${appState.cart.length} items)</span><button class="btn-danger btn-xs" id="clearCartBtn">Clear All</button></div>
      <div class="panel-body">
        <div class="pos-customer-bar">
          <div class="pos-customer-current">
            <span class="pos-customer-label">Customer / Patient</span>
            <div id="selectedCustomerSummary">
              ${patient
                ? `<b>${esc(patient.name)}</b><small>${esc(patient.phone||'No phone')} ${patient.email?'• '+esc(patient.email):''}</small>`
                : '<b>Walk-in Customer</b><small>No patient selected</small>'}
            </div>
          </div>
          <button class="btn-primary" id="customerLookupBtn">🔎 Customer Lookup</button>
          <button class="btn-light" id="quickAddPatientBtn">+ New Patient</button>
          ${patient?'<button class="btn-light" id="clearCustomerBtn">Walk-in</button>':''}
        </div>

        ${patient && (patient.allergies||patient.medicalConditions)
          ? `<div class="patient-alert-strip">
              ${patient.allergies?`<span><b>Allergies:</b> ${esc(patient.allergies)}</span>`:''}
              ${patient.medicalConditions?`<span><b>Conditions:</b> ${esc(patient.medicalConditions)}</span>`:''}
             </div>`
          : ''}

        <div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>
        ${appState.cart.map((l,i)=>`<tr><td><b>${esc(l.productName)}</b>${l.directions?`<br><small class="directions-line">${esc(l.directions)}</small>`:''}</td><td>${esc(l.batchNo)}</td><td>${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:70px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button> `:''}<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Scan or select a medicine to begin.</td></tr>'}
        </tbody></table></div>

        <div class="cart-summary"><div class="sum-box">Subtotal<strong>${money(subtotal)}</strong></div><div class="sum-box">Discount<strong>${money(0)}</strong></div><div class="sum-box total-box">Total<strong>${money(subtotal)}</strong></div></div>
        <div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div>
        <div class="checkout-actions"><button class="btn-light" id="holdSaleBtn">Hold</button><button class="btn-light" id="printBtn">Print</button><button class="btn-success btn-lg" id="completeSaleBtn" ${appState.cart.length?'':'disabled'}>Complete Sale</button></div>
      </div>
    </div>
  </div>`;
}

/*
 PURPOSE:
 Opens an in-POS customer lookup with search and patient alert details.
 REFERENCE:
 Search covers full name, phone, email and numeric patient ID.
*/
function showPosCustomerLookup(){
  const host=document.createElement('div');
  host.className='modal-backdrop';

  host.innerHTML=`
    <div class="modal wide customer-lookup-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">Customer Lookup</b>
          <div class="muted">Search by name, phone, email, or patient ID.</div>
        </div>
        <button class="close-btn" id="customerLookupClose">×</button>
      </div>
      <div class="modal-body">
        <div class="customer-lookup-search">
          <input id="customerLookupSearch" placeholder="Type customer name, phone, email, or ID..." autocomplete="off">
          <button class="btn-light" id="customerLookupWalkIn">Use Walk-in Customer</button>
        </div>
        <div id="customerLookupResults"></div>
      </div>
    </div>`;

  document.body.appendChild(host);

  const input=document.getElementById('customerLookupSearch');
  const results=document.getElementById('customerLookupResults');
  const close=()=>host.remove();

  const renderResults=()=>{
    const q=String(input.value||'').trim().toLowerCase();
    const list=appState.customers
      .filter(c=>{
        if(!q)return true;
        return `${c.id} ${c.name||''} ${c.phone||''} ${c.email||''}`.toLowerCase().includes(q);
      })
      .slice(0,50);

    results.innerHTML=`
      <div class="customer-lookup-count">${list.length} patient${list.length===1?'':'s'} found</div>
      <div class="table-wrap customer-lookup-table-wrap" style="overflow-x:auto">
        <table class="data-table customer-lookup-real-table" style="min-width:980px;width:100%;table-layout:fixed">
          <colgroup>
            <col style="width:18%">
            <col style="width:10%">
            <col style="width:14%">
            <col style="width:22%">
            <col style="width:27%">
            <col style="width:9%">
          </colgroup>
          <thead>
            <tr><th>Name</th><th>Patient ID</th><th>Phone</th><th>Email</th><th>Alerts</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${list.map(c=>`
              <tr class="${Number(appState.selectedCustomerId)===c.id?'selected-row':''}">
                <td><b>${esc(c.name)}</b></td>
                <td>#${c.id}</td>
                <td>${esc(c.phone||'—')}</td>
                <td class="customer-email-cell">${esc(c.email||'—')}</td>
                <td>
                  <div class="customer-lookup-alerts">
                    ${c.allergies?`<span class="lookup-alert allergy">Allergy: ${esc(c.allergies)}</span>`:''}
                    ${c.medicalConditions?`<span class="lookup-alert condition">Condition: ${esc(c.medicalConditions)}</span>`:''}
                    ${!c.allergies&&!c.medicalConditions?'<span class="lookup-alert clear">No alerts</span>':''}
                  </div>
                </td>
                <td><button type="button" class="btn-primary btn-xs" data-select-customer="${c.id}">Select</button></td>
              </tr>`).join('') || `<tr><td colspan="6" class="empty">No matching patients.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    results.querySelectorAll('[data-select-customer]').forEach(btn=>btn.onclick=()=>{
      appState.selectedCustomerId=Number(btn.dataset.selectCustomer);
      close();
      render();
      toast('Patient selected.');
    });
  };

  document.getElementById('customerLookupClose').onclick=close;
  document.getElementById('customerLookupWalkIn').onclick=()=>{
    appState.selectedCustomerId=null;
    close();
    render();
    toast('Walk-in Customer selected.');
  };

  input.addEventListener('input',renderResults);
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'){
      const first=results.querySelector('[data-select-customer]');
      if(first){
        e.preventDefault();
        first.click();
      }
    }
  });

  renderResults();
  setTimeout(()=>input.focus(),0);
}

/*
 PURPOSE:
 Wires v5.3 POS including customer lookup and barcode auto-entry.
 REFERENCE:
 Exact barcode Enter handling, batch selection, quantities and offline sale behavior
 are preserved from v5.1/v5.2.
*/
function bindPos(){
  const search=document.getElementById('posSearch');

  const filter=()=>{
    const q=(search?.value||'').toLowerCase();
    document.querySelectorAll('.product-row').forEach(row=>{
      const p=appState.products.find(x=>String(x.id)===row.dataset.productId);
      row.style.display=!q||`${p?.name} ${p?.genericName} ${p?.barcode} ${p?.rxNormId}`.toLowerCase().includes(q)?'':'none';
    });
  };

  search?.addEventListener('input',filter);
  search?.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    e.preventDefault();
    const value=String(search.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());

    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filter();
      return;
    }

    filter();
    toast(value?`No exact barcode match for ${value}.`:'Scan or enter a barcode.','warning');
    search.select();
  });

  document.getElementById('posSearchBtn')?.addEventListener('click',()=>{
    const value=String(search?.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filter();
    }else{
      filter();
    }
  });

  document.querySelectorAll('[data-product-id]').forEach(row=>row.onclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });

  document.getElementById('customerLookupBtn')?.addEventListener('click',showPosCustomerLookup);
  document.getElementById('clearCustomerBtn')?.addEventListener('click',()=>{
    appState.selectedCustomerId=null;
    render();
    toast('Walk-in Customer selected.');
  });
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));

  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });

  document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render();});
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));
  document.getElementById('completeSaleBtn')?.addEventListener('click',completeSale);
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());

  document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({
      id:Date.now(),
      cart:appState.cart,
      paymentMethod:appState.paymentMethod,
      customerId:appState.selectedCustomerId
    });
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    render();
    toast('Sale held locally.');
  });

  setTimeout(()=>search?.focus(),0);
}


/* ============================================================================
 CASHIER + PENDING PAYMENT WORKFLOW — v5.4
 PURPOSE:
 Supports two checkout routes:
 1) Pay Here: payment is completed at the sale station.
 2) Send to Cashier: sale is created with Payment Status Pending and is collected
    from the Cashier screen later.
 REFERENCE:
 Pending state uses the existing Sale.PaymentMethod marker PENDING::<method> so
 existing MSSQL LocalDB installations do not require a schema reset.
============================================================================ */

/* PURPOSE: Default tenant/browser checkout-routing setting. */
function defaultCheckoutSettings(){
  return {defaultRoute:'here'};
}

/* PURPOSE: Tenant-specific storage key for checkout routing. */
function checkoutSettingsStorageKey(){
  return `pharmacare.checkoutSettings.${appState.session?.tenantId||'default'}`;
}

/* PURPOSE: Reads the default checkout route selected in Settings > Checkout. */
function getCheckoutSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(checkoutSettingsStorageKey())||'null');
    return {...defaultCheckoutSettings(),...(saved||{})};
  }catch{
    return defaultCheckoutSettings();
  }
}

/* PURPOSE: Saves the default checkout route. */
function saveCheckoutSettings(settings){
  localStorage.setItem(checkoutSettingsStorageKey(),JSON.stringify({...defaultCheckoutSettings(),...settings}));
}

/*
 PURPOSE:
 v5.4 POS renderer with explicit Pay Here and Send to Cashier actions.
 REFERENCE:
 Customer lookup, barcode scanning, batch, quantity, directions and printer
 workflows are retained from prior versions.
*/
function posView(){
  const subtotal=appState.cart.reduce((s,l)=>s+l.quantity*l.unitPrice,0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const checkout=getCheckoutSettings();

  return `<div class="page-header"><div><h1>POS Sales</h1><p>Fast billing with patient, batch, expiry and cashier routing</p></div><span class="sync-pill">${navigator.onLine?'🟢 Online sync ready':'🟠 Offline queue ready'}</span></div>
  ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode: invoices are saved locally first. Cashier-bound orders appear at Cashier after synchronization.</div>'}
  <div class="pos-grid">
    <div class="panel product-search-panel">
      <div class="panel-head"><span>Find Medicine</span><span class="badge blue">F2 Search</span></div>
      <div class="pos-search"><input id="posSearch" placeholder="Scan barcode or search medicine..."><button class="btn-primary" id="posSearchBtn">Search</button></div>
      <div class="product-list">${appState.products.slice(0,1000).map(p=>`
        <div class="product-row ${p.id===appState.selectedProductId?'selected':''}" data-product-id="${p.id}">
          <div><b>${esc(p.name)}</b><br><small>${esc(p.genericName||'')}</small></div>
          <div>${esc(p.strength||'')}</div>
          <div>${money(p.sellingPrice)}</div>
          <div>${stockForProduct(p.id)}</div>
        </div>`).join('')}</div>
    </div>

    <div class="panel">
      <div class="panel-head"><span>Cart (${appState.cart.length} items)</span><button class="btn-danger btn-xs" id="clearCartBtn">Clear All</button></div>
      <div class="panel-body">
        <div class="pos-customer-bar pos-customer-inline">
          <span class="pos-customer-inline-label">Customer / Patient</span>
          <div class="pos-customer-inline-details">
            <b>${patient?esc(patient.name):'Walk-in Customer'}</b>
            ${patient?.phone?`<span class="customer-inline-sep">•</span><span>${esc(patient.phone)}</span>`:''}
            ${patient?.email?`<span class="customer-inline-sep">•</span><span>${esc(patient.email)}</span>`:''}
          </div>
          <div class="pos-customer-inline-actions">
            <button class="btn-primary" id="customerLookupBtn">🔎 Lookup</button>
            <button class="btn-light" id="quickAddPatientBtn">+ New Patient</button>
            <button class="btn-light" id="clearCustomerBtn" ${patient?'':'disabled'}>Walk-in</button>
          </div>
        </div>

        ${patient && (patient.allergies||patient.medicalConditions)
          ? `<div class="patient-alert-strip">
              ${patient.allergies?`<span><b>Allergies:</b> ${esc(patient.allergies)}</span>`:''}
              ${patient.medicalConditions?`<span><b>Conditions:</b> ${esc(patient.medicalConditions)}</span>`:''}
             </div>`
          : ''}

        <div class="table-wrap"><table class="data-table"><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Qty</th><th>Price</th><th>Amount</th><th></th></tr></thead><tbody>
        ${appState.cart.map((l,i)=>`<tr><td><b>${esc(l.productName)}</b>${l.directions?`<br><small class="directions-line">${esc(l.directions)}</small>`:''}</td><td>${esc(l.batchNo)}</td><td>${fmtDate(l.expiryDate)}</td><td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}" style="width:70px"></td><td>${money(l.unitPrice)}</td><td>${money(l.quantity*l.unitPrice)}</td><td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button> `:''}<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">Scan or select a medicine to begin.</td></tr>'}
        </tbody></table></div>

        <div class="cart-summary"><div class="sum-box">Subtotal<strong>${money(subtotal)}</strong></div><div class="sum-box">Discount<strong>${money(0)}</strong></div><div class="sum-box total-box">Total<strong>${money(subtotal)}</strong></div></div>

        <div style="margin-top:14px">
          <b>Payment Method</b>
          <div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div>
        </div>

        <div class="checkout-route-note">Default: <b>${checkout.defaultRoute==='cashier'?'Send to Cashier':'Pay Here'}</b> <span>• Change in Settings → Checkout</span></div>
        <div class="checkout-actions checkout-two-way">
          <button class="btn-light" id="holdSaleBtn">Hold</button>
          <button class="btn-light" id="printBtn">Print</button>
          <button class="${checkout.defaultRoute==='here'?'btn-success':'btn-primary'} btn-lg" id="payHereBtn" ${appState.cart.length?'':'disabled'}>💳 Pay Here</button>
          <button class="${checkout.defaultRoute==='cashier'?'btn-success':'btn-purple'} btn-lg" id="sendCashierBtn" ${appState.cart.length?'':'disabled'}>💵 Send to Cashier</button>
        </div>
      </div>
    </div>
  </div>`;
}

/*
 PURPOSE:
 v5.4 POS event binding including the two checkout actions.
 REFERENCE:
 Barcode Enter behavior and customer lookup remain active.
*/
function bindPos(){
  const search=document.getElementById('posSearch');

  const filter=()=>{
    const q=(search?.value||'').toLowerCase();
    document.querySelectorAll('.product-row').forEach(row=>{
      const p=appState.products.find(x=>String(x.id)===row.dataset.productId);
      row.style.display=!q||`${p?.name} ${p?.genericName} ${p?.barcode} ${p?.rxNormId}`.toLowerCase().includes(q)?'':'none';
    });
  };

  search?.addEventListener('input',filter);
  search?.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    e.preventDefault();
    const value=String(search.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filter();
      return;
    }
    filter();
    toast(value?`No exact barcode match for ${value}.`:'Scan or enter a barcode.','warning');
    search.select();
  });

  document.getElementById('posSearchBtn')?.addEventListener('click',()=>{
    const value=String(search?.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filter();
    }else filter();
  });

  document.querySelectorAll('[data-product-id]').forEach(row=>row.onclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });

  document.getElementById('customerLookupBtn')?.addEventListener('click',showPosCustomerLookup);
  document.getElementById('clearCustomerBtn')?.addEventListener('click',()=>{appState.selectedCustomerId=null;render();toast('Walk-in Customer selected.');});
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));

  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });

  document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render();});
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.addEventListener('click',()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)])));

  document.getElementById('payHereBtn')?.addEventListener('click',()=>completeSale('here'));
  document.getElementById('sendCashierBtn')?.addEventListener('click',()=>completeSale('cashier'));
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());

  document.getElementById('holdSaleBtn')?.addEventListener('click',()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({id:Date.now(),cart:appState.cart,paymentMethod:appState.paymentMethod,customerId:appState.selectedCustomerId});
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    render();
    toast('Sale held locally.');
  });

  setTimeout(()=>search?.focus(),0);
}

/*
 PURPOSE:
 Completes a POS order using either immediate payment or cashier-pending payment.
 REFERENCE:
 Pending cashier orders use PENDING::<suggested method> until Cashier marks paid.
*/
async function completeSale(route='here'){
  if(!appState.cart.length)return;

  const checkoutRoute=route==='cashier'?'cashier':'here';
  const printCart=appState.cart.map(x=>({...x}));
  const printCustomerId=appState.selectedCustomerId||null;
  const opId=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;

  const serverPaymentMethod=checkoutRoute==='cashier'
    ? `PENDING::${appState.paymentMethod||'Cash'}`
    : (appState.paymentMethod||'Cash');

  const sale={
    tenantId:appState.session.tenantId,
    branchId:appState.session.branchId,
    clientOperationId:opId,
    discount:0,
    paymentMethod:serverPaymentMethod,
    customerId:printCustomerId,
    lines:appState.cart.map(x=>({batchId:x.batchId,quantity:x.quantity})),
    localCreatedUtc:new Date().toISOString(),
    status:'pending'
  };

  await PharmaOffline.put('pendingSales',opId,sale);

  for(const line of appState.cart){
    const b=appState.batches.find(x=>x.id===line.batchId);
    if(b)b.quantity=Math.max(0,Number(b.quantity)-Number(line.quantity));
  }
  await PharmaOffline.replaceAll('batches',appState.batches);

  const ps=getPrinterSettings();
  if(checkoutRoute==='here' && ps.autoPrintBill){
    const oldCustomerId=appState.selectedCustomerId;
    appState.selectedCustomerId=printCustomerId;
    await printHtmlToConfiguredPrinter('bill',buildBillHtml(printCart));
    appState.selectedCustomerId=oldCustomerId;
  }

  appState.cart=[];
  appState.selectedCustomerId=null;
  render();

  if(checkoutRoute==='cashier'){
    toast(navigator.onLine
      ? 'Order sent to Cashier with Payment Status: Pending.'
      : 'Order saved offline. It will appear at Cashier after synchronization.','success');
  }else{
    toast(navigator.onLine?'Payment complete. Sale is synchronizing...':'Paid sale saved offline. It will sync automatically.','success');
  }

  if(navigator.onLine){
    await syncPendingSales();
    await refreshSnapshot();
    await loadDashboard();
    render();
  }
}

/*
 PURPOSE:
 Renders the Cashier window where pending payments wait to be collected.
 REFERENCE:
 Data is loaded from the central server so multiple sale stations feed one cashier.
*/
function cashierView(){
  return `
  <div class="page-header">
    <div><h1>Cashier</h1><p>Collect and complete payments sent from sales stations</p></div>
    <button class="btn-primary" id="refreshCashierBtn">↻ Refresh Pending</button>
  </div>
  <div class="cards cashier-summary-cards">
    <div class="metric orange"><div class="label">Pending Payments</div><div class="value" id="cashierPendingCount">—</div></div>
    <div class="metric purple"><div class="label">Pending Value</div><div class="value" id="cashierPendingValue">—</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><span>Pending Payment Queue</span><span class="badge orange">Payment Pending</span></div>
    <div class="panel-body" id="cashierPendingBody">
      <div class="empty">Loading pending payments...</div>
    </div>
  </div>`;
}

/* PURPOSE: Loads pending payment orders into the Cashier screen. */
async function loadCashierPending(){
  const body=document.getElementById('cashierPendingBody');
  if(!body)return;

  if(!navigator.onLine){
    body.innerHTML='<div class="empty">Cashier requires a server connection. Offline POS orders will appear here after they synchronize.</div>';
    return;
  }

  try{
    const rows=await api(`/api/cashier/pending?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);
    const total=rows.reduce((sum,x)=>sum+Number(x.total||0),0);
    const count=document.getElementById('cashierPendingCount');
    const value=document.getElementById('cashierPendingValue');
    if(count)count.textContent=String(rows.length);
    if(value)value.textContent=money(total);

    body.innerHTML=rows.length?`
      <div class="table-wrap">
        <table class="data-table cashier-table">
          <thead><tr><th>Invoice</th><th>Time</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${rows.map(row=>`
              <tr>
                <td><b>${esc(row.invoiceNo)}</b></td>
                <td>${new Date(row.createdUtc).toLocaleString()}</td>
                <td><b>${esc(row.customerName||'Walk-in Customer')}</b><br><small class="muted">${esc(row.customerPhone||'')}</small></td>
                <td><b class="cashier-amount">${money(row.total)}</b></td>
                <td>
                  <select class="cashier-payment-method" data-cashier-method="${row.id}">
                    ${['Cash','Card','UPI','Split'].map(x=>`<option ${String(row.suggestedPaymentMethod||'').toLowerCase()===x.toLowerCase()?'selected':''}>${x}</option>`).join('')}
                  </select>
                </td>
                <td><span class="badge orange">Pending</span></td>
                <td><button class="btn-success" data-complete-payment="${row.id}">✓ Payment Complete</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`
      : '<div class="empty cashier-empty">✓ No pending payments. Cashier queue is clear.</div>';

    body.querySelectorAll('[data-complete-payment]').forEach(btn=>btn.onclick=async()=>{
      const saleId=Number(btn.dataset.completePayment);
      const select=body.querySelector(`[data-cashier-method="${saleId}"]`);
      const paymentMethod=select?.value||'Cash';

      if(!confirm(`Confirm payment received by ${paymentMethod}?`))return;

      btn.disabled=true;
      btn.textContent='Completing...';
      try{
        await api(`/api/cashier/${saleId}/complete`,{
          method:'PUT',
          body:JSON.stringify({
            tenantId:appState.session.tenantId,
            branchId:appState.session.branchId,
            paymentMethod
          })
        });
        toast('Payment marked complete.','success');
        await loadCashierPending();
      }catch(e){
        btn.disabled=false;
        btn.textContent='✓ Payment Complete';
        toast(e.message,'error');
      }
    });
  }catch(e){
    body.innerHTML=`<div class="empty">Unable to load cashier queue: ${esc(e.message)}</div>`;
  }
}

/* PURPOSE: Wires Cashier refresh and loads the queue on entry. */
function bindCashier(){
  document.getElementById('refreshCashierBtn')?.addEventListener('click',loadCashierPending);
  loadCashierPending();
}


/* ============================================================================
 PAYMENT CONFIRMATION UI + PDF REPORTS — v5.6
 PURPOSE:
 Replaces browser confirm() prompts with a branded in-app payment modal and makes
 every report tile download a PDF with the pharmacy/company header.
 REFERENCE:
 jsPDF + AutoTable are loaded in index.html for client-side PDF generation.
============================================================================ */

/*
 PURPOSE:
 Shows a styled cashier payment confirmation modal instead of the browser confirm().
 REFERENCE:
 Returns a Promise<boolean> so the cashier workflow stays easy to read.
*/
function showPaymentConfirmationModal(row,paymentMethod){
  return new Promise(resolve=>{
    const host=document.createElement('div');
    host.className='modal-backdrop';
    host.innerHTML=`
      <div class="modal payment-confirm-modal">
        <div class="modal-head">
          <div>
            <b class="batch-modal-title">Confirm Payment</b>
            <div class="muted">Verify the payment before completing this cashier order.</div>
          </div>
          <button class="close-btn" id="paymentConfirmClose">×</button>
        </div>
        <div class="modal-body">
          <div class="payment-confirm-amount">
            <span>Amount Due</span>
            <strong>${money(row.total)}</strong>
          </div>
          <div class="payment-confirm-grid">
            <div><span>Invoice</span><b>${esc(row.invoiceNo)}</b></div>
            <div><span>Customer</span><b>${esc(row.customerName||'Walk-in Customer')}</b></div>
            <div><span>Payment Method</span><b>${esc(paymentMethod)}</b></div>
            <div><span>Status</span><b class="danger-text">Pending → Complete</b></div>
          </div>
          <div class="section-note"><b>Confirm only after payment has been received.</b></div>
        </div>
        <div class="modal-foot">
          <button class="btn-light" id="paymentConfirmCancel">Cancel</button>
          <button class="btn-success btn-lg" id="paymentConfirmOk">✓ Payment Received</button>
        </div>
      </div>`;
    document.body.appendChild(host);

    let finished=false;
    const done=value=>{
      if(finished)return;
      finished=true;
      host.remove();
      resolve(value);
    };

    document.getElementById('paymentConfirmClose').onclick=()=>done(false);
    document.getElementById('paymentConfirmCancel').onclick=()=>done(false);
    document.getElementById('paymentConfirmOk').onclick=()=>done(true);
  });
}

/*
 PURPOSE:
 Loads and renders pending cashier orders using the branded confirmation modal.
 REFERENCE:
 Replaces the browser-native confirm dialog that looked disconnected from the POS.
*/
async function loadCashierPending(){
  const body=document.getElementById('cashierPendingBody');
  if(!body)return;

  if(!navigator.onLine){
    body.innerHTML='<div class="empty">Cashier requires a server connection. Offline POS orders will appear here after they synchronize.</div>';
    return;
  }

  try{
    const rows=await api(`/api/cashier/pending?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);
    const total=rows.reduce((sum,x)=>sum+Number(x.total||0),0);
    const count=document.getElementById('cashierPendingCount');
    const value=document.getElementById('cashierPendingValue');
    if(count)count.textContent=String(rows.length);
    if(value)value.textContent=money(total);

    body.innerHTML=rows.length?`
      <div class="table-wrap">
        <table class="data-table cashier-table">
          <thead><tr><th>Invoice</th><th>Time</th><th>Customer</th><th>Amount</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            ${rows.map(row=>`
              <tr>
                <td><b>${esc(row.invoiceNo)}</b></td>
                <td>${new Date(row.createdUtc).toLocaleString()}</td>
                <td><b>${esc(row.customerName||'Walk-in Customer')}</b><br><small class="muted">${esc(row.customerPhone||'')}</small></td>
                <td><b class="cashier-amount">${money(row.total)}</b></td>
                <td>
                  <select class="cashier-payment-method" data-cashier-method="${row.id}">
                    ${['Cash','Card','UPI','Split'].map(x=>`<option ${String(row.suggestedPaymentMethod||'').toLowerCase()===x.toLowerCase()?'selected':''}>${x}</option>`).join('')}
                  </select>
                </td>
                <td><span class="badge orange">Pending</span></td>
                <td><button class="btn-success" data-complete-payment="${row.id}">✓ Payment Complete</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`
      : '<div class="empty cashier-empty">✓ No pending payments. Cashier queue is clear.</div>';

    body.querySelectorAll('[data-complete-payment]').forEach(btn=>btn.onclick=async()=>{
      const saleId=Number(btn.dataset.completePayment);
      const row=rows.find(x=>x.id===saleId);
      const select=body.querySelector(`[data-cashier-method="${saleId}"]`);
      const paymentMethod=select?.value||'Cash';

      const confirmed=await showPaymentConfirmationModal(row,paymentMethod);
      if(!confirmed)return;

      btn.disabled=true;
      btn.textContent='Completing...';
      try{
        await api(`/api/cashier/${saleId}/complete`,{
          method:'PUT',
          body:JSON.stringify({
            tenantId:appState.session.tenantId,
            branchId:appState.session.branchId,
            paymentMethod
          })
        });
        toast('Payment marked complete.','success');
        await loadCashierPending();
      }catch(e){
        btn.disabled=false;
        btn.textContent='✓ Payment Complete';
        toast(e.message,'error');
      }
    });
  }catch(e){
    body.innerHTML=`<div class="empty">Unable to load cashier queue: ${esc(e.message)}</div>`;
  }
}

/*
 PURPOSE:
 Returns the jsPDF constructor or throws a user-friendly message if PDF scripts
 are not available.
 REFERENCE:
 Report PDFs require the jsPDF browser library loaded from index.html.
*/
function getPdfConstructor(){
  const ctor=window.jspdf?.jsPDF;
  if(!ctor)throw new Error('PDF library is not loaded. Check internet access and refresh the page.');
  return ctor;
}

/*
 PURPOSE:
 Adds the company/pharmacy header to each PDF report page.
 REFERENCE:
 Uses Settings > General pharmacy name and address so all reports share branding.
*/
function drawCompanyPdfHeader(doc,reportTitle){
  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'PharmaCare POS';
  const address=appState.settings?.address||'';
  const pageWidth=doc.internal.pageSize.getWidth();

  doc.setFont('helvetica','bold');
  doc.setFontSize(16);
  doc.text(String(pharmacy),14,15);

  doc.setFont('helvetica','normal');
  doc.setFontSize(9);
  if(address)doc.text(String(address),14,21);

  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.text(String(reportTitle),14,address?30:25);

  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleString()}`,pageWidth-14,address?30:25,{align:'right'});
  doc.setDrawColor(190);
  doc.line(14,address?34:29,pageWidth-14,address?34:29);
}

/*
 PURPOSE:
 Downloads a branded tabular PDF report with a repeating company header.
 REFERENCE:
 AutoTable repeats table headings and calls didDrawPage for each report page.
*/
function downloadCompanyPdf(reportTitle,filename,headers,rows,summaryLines=[]){
  const JsPdf=getPdfConstructor();
  const doc=new JsPdf({orientation:'landscape',unit:'mm',format:'a4'});
  const headerBottom=appState.settings?.address?36:31;

  doc.autoTable({
    head:[headers],
    body:rows.map(row=>row.map(value=>String(value??''))),
    startY:headerBottom+4,
    margin:{top:headerBottom+4,left:14,right:14,bottom:15},
    styles:{fontSize:8,cellPadding:2.3,overflow:'linebreak'},
    headStyles:{fillColor:[13,94,145],textColor:255,fontStyle:'bold'},
    alternateRowStyles:{fillColor:[246,249,252]},
    didDrawPage:()=>drawCompanyPdfHeader(doc,reportTitle)
  });

  let y=(doc.lastAutoTable?.finalY||headerBottom)+8;
  if(summaryLines.length){
    if(y>185){doc.addPage();drawCompanyPdfHeader(doc,reportTitle);y=42;}
    doc.setFont('helvetica','bold');
    doc.setFontSize(10);
    summaryLines.forEach(line=>{
      doc.text(String(line),14,y);
      y+=6;
    });
  }

  const pageCount=doc.internal.getNumberOfPages();
  for(let i=1;i<=pageCount;i++){
    doc.setPage(i);
    const width=doc.internal.pageSize.getWidth();
    const height=doc.internal.pageSize.getHeight();
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.text(`Page ${i} of ${pageCount}`,width-14,height-7,{align:'right'});
  }

  doc.save(filename);
}

/* PURPOSE: Builds and downloads the current stock PDF report. */
function downloadStockReportPdf(){
  const rows=appState.batches.map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    return [
      p?.name||'',
      b.batchNo,
      fmtDate(b.expiryDate),
      b.quantity,
      money(b.purchasePrice),
      money(b.sellingPrice),
      money(Number(b.quantity)*Number(b.purchasePrice))
    ];
  });
  const value=appState.batches.reduce((sum,b)=>sum+Number(b.quantity)*Number(b.purchasePrice),0);
  downloadCompanyPdf('Stock Report','stock-report.pdf',
    ['Product','Batch','Expiry','Qty','Cost','Selling','Stock Value'],
    rows,[`Total Stock Value: ${money(value)}`]);
}

/* PURPOSE: Builds and downloads the expiry PDF report. */
function downloadExpiryReportPdf(){
  const sorted=[...appState.batches].sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate));
  const rows=sorted.map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    const left=daysLeft(b.expiryDate);
    return [p?.name||'',b.batchNo,fmtDate(b.expiryDate),left,b.quantity,left<0?'Expired':left<=60?'Near Expiry':'Valid'];
  });
  downloadCompanyPdf('Expiry Report','expiry-report.pdf',
    ['Product','Batch','Expiry Date','Days Left','Qty','Status'],rows);
}

/*
 PURPOSE:
 Creates a purchase/receiving valuation PDF from the synchronized batch records.
 REFERENCE:
 Current data model does not store historical purchase headers, so this report is
 explicitly a current receiving/stock-cost snapshot rather than invented history.
*/
function downloadPurchaseReportPdf(){
  const rows=appState.batches.map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    return [p?.name||'',b.batchNo,fmtDate(b.expiryDate),b.quantity,money(b.purchasePrice),money(Number(b.quantity)*Number(b.purchasePrice))];
  });
  const total=appState.batches.reduce((sum,b)=>sum+Number(b.quantity)*Number(b.purchasePrice),0);
  downloadCompanyPdf('Purchase / Receiving Snapshot','purchase-report.pdf',
    ['Product','Batch','Expiry','Current Qty','Purchase Cost','Current Cost Value'],
    rows,[`Current Purchase-Cost Value: ${money(total)}`]);
}

/* PURPOSE: Creates and downloads the patient/customer PDF report. */
function downloadCustomerReportPdf(){
  const rows=appState.customers.map(c=>[
    c.id,
    c.name,
    c.phone||'',
    c.email||'',
    c.allergies||'None recorded',
    c.medicalConditions||'None recorded'
  ]);
  downloadCompanyPdf('Customer / Patient Report','customer-report.pdf',
    ['Patient ID','Full Name','Phone','Email','Allergies','Medical Conditions'],rows,
    [`Total Patients: ${appState.customers.length}`]);
}

/* PURPOSE: Creates a sales PDF using server invoice data. */
function downloadSalesReportPdf(data){
  const sales=data.sales||[];
  const rows=sales.map(s=>[
    s.invoiceNo,
    new Date(s.createdUtc).toLocaleString(),
    s.customerId||'Walk-in',
    String(s.paymentMethod||'').startsWith('PENDING::')?'Pending':s.paymentMethod,
    money(s.subtotal),
    money(s.discount),
    money(s.total)
  ]);
  const total=sales.reduce((sum,s)=>sum+Number(s.total||0),0);
  downloadCompanyPdf('Sales Report','sales-report.pdf',
    ['Invoice','Date/Time','Customer ID','Payment','Subtotal','Discount','Total'],
    rows,[`Invoices: ${sales.length}`,`Total Sales: ${money(total)}`]);
}

/* PURPOSE: Creates a product-level profit PDF using recorded sale lines. */
function downloadProfitReportPdf(data){
  const lines=data.lines||[];
  const grouped=new Map();

  lines.forEach(line=>{
    const p=appState.products.find(x=>x.id===line.productId);
    const key=line.productId;
    const row=grouped.get(key)||{
      product:p?.name||line.productName||`Product ${key}`,
      qty:0,revenue:0,cost:0
    };
    row.qty+=Number(line.quantity||0);
    row.revenue+=Number(line.lineTotal||0);
    row.cost+=Number(line.quantity||0)*Number(p?.purchasePrice||0);
    grouped.set(key,row);
  });

  const values=[...grouped.values()];
  const rows=values.map(x=>[
    x.product,x.qty,money(x.revenue),money(x.cost),money(x.revenue-x.cost)
  ]);
  const revenue=values.reduce((s,x)=>s+x.revenue,0);
  const cost=values.reduce((s,x)=>s+x.cost,0);

  downloadCompanyPdf('Profit & Loss Report','profit-loss-report.pdf',
    ['Product','Qty Sold','Revenue','Estimated Cost','Gross Profit'],
    rows,[`Revenue: ${money(revenue)}`,`Estimated Cost: ${money(cost)}`,`Gross Profit: ${money(revenue-cost)}`]);
}

/*
 PURPOSE:
 Makes every Reports tile download a PDF with the company header.
 REFERENCE:
 Sales/profit use central invoice data; stock/expiry/customer and receiving snapshot
 use the synchronized local catalogue.
*/
function bindReports(){
  document.querySelectorAll('[data-report]').forEach(card=>card.addEventListener('click',async()=>{
    const type=card.dataset.report;
    try{
      if(type==='stock')return downloadStockReportPdf();
      if(type==='expiry')return downloadExpiryReportPdf();
      if(type==='customer')return downloadCustomerReportPdf();
      if(type==='purchase')return downloadPurchaseReportPdf();

      if(!navigator.onLine)return toast('Sales and profit PDF reports require server connection.','warning');
      const data=await api(`/api/reports/sales?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);
      if(type==='profit')downloadProfitReportPdf(data);
      else downloadSalesReportPdf(data);
      toast('PDF report downloaded.','success');
    }catch(e){
      toast(e.message,'error');
    }
  }));
}

/*
 PURPOSE:
 Updates report cards to make the PDF-download behavior obvious.
 REFERENCE:
 Each report card now performs one direct PDF download.
*/
function reportsView(){
  return `<div class="page-header"><div><h1>Reports</h1><p>Download branded PDF reports with company header</p></div></div>
  <div class="report-pdf-note">Every report downloads as PDF using <b>${esc(appState.settings?.pharmacyName||appState.session?.tenantName||'Pharmacy')}</b> and the saved company address.</div>
  <div class="report-cards">
    <div class="report-card green" data-report="sales"><span>📈 Sales Report</span><small>Download PDF</small></div>
    <div class="report-card blue" data-report="purchase"><span>🛒 Purchase Report</span><small>Download PDF receiving snapshot</small></div>
    <div class="report-card orange" data-report="stock"><span>📦 Stock Report</span><small>Download PDF</small></div>
    <div class="report-card red" data-report="expiry"><span>📅 Expiry Report</span><small>Download PDF</small></div>
    <div class="report-card purple" data-report="profit"><span>◔ Profit & Loss</span><small>Download PDF</small></div>
    <div class="report-card teal" data-report="customer"><span>👥 Customer Report</span><small>Download PDF</small></div>
  </div>`;
}

/*
 PURPOSE:
 Keeps Stock screen controls working while changing Export to branded PDF.
*/
function bindStock(){
  document.getElementById('syncNowBtn')?.addEventListener('click',async()=>{await syncPendingSales();await refreshSnapshot();render();toast('Sync complete.');});
  const filter=()=>{
    const q=(document.getElementById('stockSearch')?.value||'').toLowerCase();
    const status=document.getElementById('stockStatus')?.value||'all';
    document.querySelectorAll('[data-stock-view]').forEach(btn=>{
      const row=btn.closest('tr');
      const batch=appState.batches.find(x=>x.id===Number(btn.dataset.stockView));
      const product=appState.products.find(x=>x.id===batch?.productId);
      const dl=batch?daysLeft(batch.expiryDate):9999;
      const matchText=!q||`${product?.name} ${batch?.batchNo}`.toLowerCase().includes(q);
      const matchStatus=status==='all'||(status==='low'&&Number(batch?.quantity)<=10)||(status==='expiry'&&dl>=0&&dl<=60)||(status==='expired'&&dl<0);
      row.style.display=matchText&&matchStatus?'':'none';
    });
  };
  document.getElementById('stockSearch')?.addEventListener('input',filter);
  document.getElementById('stockStatus')?.addEventListener('change',filter);
  const exportBtn=document.getElementById('exportStockBtn');
  if(exportBtn){exportBtn.textContent='Download PDF';exportBtn.addEventListener('click',downloadStockReportPdf);}
  document.querySelectorAll('[data-stock-view]').forEach(btn=>btn.addEventListener('click',()=>showStockModal(Number(btn.dataset.stockView))));
}

/* PURPOSE: Keeps Expiry filtering working while changing Export to branded PDF. */
function bindExpiry(){
  document.getElementById('expiryFilter')?.addEventListener('change',e=>{
    const max=e.target.value==='all'?Infinity:Number(e.target.value);
    document.querySelectorAll('.data-table tbody tr').forEach(row=>{
      const cells=row.children;
      const dl=Number(cells[3]?.textContent);
      row.style.display=dl<=max?'':'none';
    });
  });
  const exportBtn=document.getElementById('exportExpiryBtn');
  if(exportBtn){exportBtn.textContent='Download PDF';exportBtn.addEventListener('click',downloadExpiryReportPdf);}
}


/* ============================================================================
 REPORT VIEWER + RELIABLE PDF FALLBACK — v5.9
 PURPOSE:
 Opens every report on screen first, then lets the user save/print it as PDF.
 REFERENCE:
 Direct jsPDF download is used when the local library is available. If a stale
 browser/service-worker cache prevents the library from loading, the report still
 works through a print-friendly browser window where the user can choose Save to PDF.
============================================================================ */

/*
 PURPOSE:
 Builds the common company header HTML used by the on-screen report and print/PDF fallback.
*/
function reportCompanyHeaderHtml(title){
  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'PharmaCare POS';
  const address=appState.settings?.address||'';
  return `
    <div class="report-company-header">
      <div>
        <h2>${esc(pharmacy)}</h2>
        ${address?`<div>${esc(address)}</div>`:''}
      </div>
      <div class="report-company-meta">
        <b>${esc(title)}</b>
        <span>Generated: ${esc(new Date().toLocaleString())}</span>
      </div>
    </div>`;
}

/*
 PURPOSE:
 Opens a full on-screen report viewer with a table and Save PDF action.
*/
function showReportViewer(report){
  const host=document.createElement('div');
  host.className='modal-backdrop';
  host.innerHTML=`
    <div class="modal wide report-viewer-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">${esc(report.title)}</b>
          <div class="muted">Preview report before saving or printing.</div>
        </div>
        <button class="close-btn" id="reportViewerClose">×</button>
      </div>
      <div class="modal-body">
        ${reportCompanyHeaderHtml(report.title)}
        <div class="report-viewer-table-wrap">
          <table class="data-table report-viewer-table">
            <thead><tr>${report.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>
              ${report.rows.map(row=>`<tr>${row.map(v=>`<td>${esc(String(v??''))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${report.headers.length}" class="empty">No report data.</td></tr>`}
            </tbody>
          </table>
        </div>
        ${report.summary?.length?`
          <div class="report-viewer-summary">
            ${report.summary.map(x=>`<div><b>${esc(x)}</b></div>`).join('')}
          </div>`:''}
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="reportViewerClose2">Close</button>
        <button class="btn-primary" id="reportViewerPrint">Print</button>
        <button class="btn-success btn-lg" id="reportViewerPdf">Save PDF</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const close=()=>host.remove();
  document.getElementById('reportViewerClose').onclick=close;
  document.getElementById('reportViewerClose2').onclick=close;
  document.getElementById('reportViewerPrint').onclick=()=>openPrintableReport(report,false);
  document.getElementById('reportViewerPdf').onclick=()=>saveReportPdf(report);
}

/*
 PURPOSE:
 Saves a report directly with jsPDF when available, otherwise opens the browser
 print dialog as a guaranteed fallback where "Save to PDF" can be selected.
*/
function saveReportPdf(report){
  const JsPdf=window.jspdf?.jsPDF;
  const hasAutoTable=Boolean(JsPdf?.API?.autoTable);

  if(JsPdf && hasAutoTable){
    try{
      const doc=new JsPdf({orientation:'landscape',unit:'mm',format:'a4'});
      const headerBottom=appState.settings?.address?36:31;

      doc.autoTable({
        head:[report.headers],
        body:report.rows.map(row=>row.map(v=>String(v??''))),
        startY:headerBottom+4,
        margin:{top:headerBottom+4,left:14,right:14,bottom:15},
        styles:{fontSize:8,cellPadding:2.3,overflow:'linebreak'},
        headStyles:{fillColor:[13,94,145],textColor:255,fontStyle:'bold'},
        alternateRowStyles:{fillColor:[246,249,252]},
        didDrawPage:()=>drawCompanyPdfHeader(doc,report.title)
      });

      let y=(doc.lastAutoTable?.finalY||headerBottom)+8;
      if(report.summary?.length){
        if(y>185){doc.addPage();drawCompanyPdfHeader(doc,report.title);y=42;}
        doc.setFont('helvetica','bold');
        doc.setFontSize(10);
        report.summary.forEach(line=>{doc.text(String(line),14,y);y+=6;});
      }

      const pageCount=doc.internal.getNumberOfPages();
      for(let i=1;i<=pageCount;i++){
        doc.setPage(i);
        const width=doc.internal.pageSize.getWidth();
        const height=doc.internal.pageSize.getHeight();
        doc.setFont('helvetica','normal');
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${pageCount}`,width-14,height-7,{align:'right'});
      }

      doc.save(report.filename);
      toast('PDF report saved.','success');
      return;
    }catch(e){
      console.warn('Direct PDF generation failed, using browser PDF fallback.',e);
    }
  }

  openPrintableReport(report,true);
  toast('PDF download library was unavailable. Choose “Save to PDF” in the print window.','info');
}

/*
 PURPOSE:
 Opens a clean printable report. When used as PDF fallback the browser's native
 print dialog can save the report as a PDF without any JavaScript PDF library.
*/
function openPrintableReport(report,saveAsPdfHint=false){
  const w=window.open('','_blank','width=1100,height=760');
  if(!w){
    toast('Popup blocked. Allow popups to print or save the report.','warning');
    return;
  }

  const pharmacy=appState.settings?.pharmacyName||appState.session?.tenantName||'PharmaCare POS';
  const address=appState.settings?.address||'';

  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
  <style>
    @page{size:A4 landscape;margin:12mm}
    body{font-family:Arial,sans-serif;color:#152b3b;margin:0}
    .head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #0d5e91;padding-bottom:10px;margin-bottom:14px}
    .head h1{font-size:20px;margin:0 0 4px}.meta{text-align:right}.meta b,.meta span{display:block}.meta span{font-size:10px;color:#60778a;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:10px}th{background:#0d5e91;color:#fff;text-align:left}th,td{border:1px solid #d7e0e7;padding:5px;vertical-align:top}
    tbody tr:nth-child(even){background:#f7fafc}.summary{margin-top:12px;font-size:11px}.hint{margin:0 0 10px;padding:7px 9px;background:#fff7d9;border:1px solid #ead28a;font-size:10px}
    @media print{.hint{display:none}}
  </style></head><body>
  ${saveAsPdfHint?'<div class="hint"><b>Save as PDF:</b> In the print dialog choose “Save to PDF” or “Microsoft Print to PDF”.</div>':''}
  <div class="head"><div><h1>${esc(pharmacy)}</h1>${address?`<div>${esc(address)}</div>`:''}</div><div class="meta"><b>${esc(report.title)}</b><span>Generated: ${esc(new Date().toLocaleString())}</span></div></div>
  <table><thead><tr>${report.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
  ${report.rows.map(row=>`<tr>${row.map(v=>`<td>${esc(String(v??''))}</td>`).join('')}</tr>`).join('')}
  </tbody></table>
  ${report.summary?.length?`<div class="summary">${report.summary.map(x=>`<div><b>${esc(x)}</b></div>`).join('')}</div>`:''}
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

/* PURPOSE: Creates stock report data for both online preview and PDF. */
function buildStockReportModel(){
  const rows=appState.batches.map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    return [p?.name||'',b.batchNo,fmtDate(b.expiryDate),b.quantity,money(b.purchasePrice),money(b.sellingPrice),money(Number(b.quantity)*Number(b.purchasePrice))];
  });
  const value=appState.batches.reduce((sum,b)=>sum+Number(b.quantity)*Number(b.purchasePrice),0);
  return {title:'Stock Report',filename:'stock-report.pdf',headers:['Product','Batch','Expiry','Qty','Cost','Selling','Stock Value'],rows,summary:[`Total Stock Value: ${money(value)}`]};
}

/* PURPOSE: Creates expiry report data for both online preview and PDF. */
function buildExpiryReportModel(){
  const rows=[...appState.batches].sort((a,b)=>new Date(a.expiryDate)-new Date(b.expiryDate)).map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    const left=daysLeft(b.expiryDate);
    return [p?.name||'',b.batchNo,fmtDate(b.expiryDate),left,b.quantity,left<0?'Expired':left<=60?'Near Expiry':'Valid'];
  });
  return {title:'Expiry Report',filename:'expiry-report.pdf',headers:['Product','Batch','Expiry Date','Days Left','Qty','Status'],rows,summary:[]};
}

/* PURPOSE: Creates current purchase/receiving snapshot report data. */
function buildPurchaseReportModel(){
  const rows=appState.batches.map(b=>{
    const p=appState.products.find(x=>x.id===b.productId);
    return [p?.name||'',b.batchNo,fmtDate(b.expiryDate),b.quantity,money(b.purchasePrice),money(Number(b.quantity)*Number(b.purchasePrice))];
  });
  const total=appState.batches.reduce((sum,b)=>sum+Number(b.quantity)*Number(b.purchasePrice),0);
  return {title:'Purchase / Receiving Snapshot',filename:'purchase-report.pdf',headers:['Product','Batch','Expiry','Current Qty','Purchase Cost','Current Cost Value'],rows,summary:[`Current Purchase-Cost Value: ${money(total)}`]};
}

/* PURPOSE: Creates customer/patient report data. */
function buildCustomerReportModel(){
  const rows=appState.customers.map(c=>[c.id,c.name,c.phone||'',c.email||'',c.allergies||'None recorded',c.medicalConditions||'None recorded']);
  return {title:'Customer / Patient Report',filename:'customer-report.pdf',headers:['Patient ID','Full Name','Phone','Email','Allergies','Medical Conditions'],rows,summary:[`Total Patients: ${appState.customers.length}`]};
}

/* PURPOSE: Creates sales report data from the server response. */
function buildSalesReportModel(data){
  const sales=data.sales||[];
  const rows=sales.map(s=>[
    s.invoiceNo,
    new Date(s.createdUtc).toLocaleString(),
    s.customerId||'Walk-in',
    String(s.paymentMethod||'').startsWith('PENDING::')?'Pending':s.paymentMethod,
    money(s.subtotal),
    money(s.discount),
    money(s.total)
  ]);
  const total=sales.reduce((sum,s)=>sum+Number(s.total||0),0);
  return {title:'Sales Report',filename:'sales-report.pdf',headers:['Invoice','Date/Time','Customer ID','Payment','Subtotal','Discount','Total'],rows,summary:[`Invoices: ${sales.length}`,`Total Sales: ${money(total)}`]};
}

/* PURPOSE: Creates profit report data from the server response. */
function buildProfitReportModel(data){
  const grouped=new Map();
  (data.lines||[]).forEach(line=>{
    const p=appState.products.find(x=>x.id===line.productId);
    const row=grouped.get(line.productId)||{product:p?.name||line.productName||`Product ${line.productId}`,qty:0,revenue:0,cost:0};
    row.qty+=Number(line.quantity||0);
    row.revenue+=Number(line.lineTotal||0);
    row.cost+=Number(line.quantity||0)*Number(p?.purchasePrice||0);
    grouped.set(line.productId,row);
  });
  const values=[...grouped.values()];
  const rows=values.map(x=>[x.product,x.qty,money(x.revenue),money(x.cost),money(x.revenue-x.cost)]);
  const revenue=values.reduce((s,x)=>s+x.revenue,0);
  const cost=values.reduce((s,x)=>s+x.cost,0);
  return {title:'Profit & Loss Report',filename:'profit-loss-report.pdf',headers:['Product','Qty Sold','Revenue','Estimated Cost','Gross Profit'],rows,summary:[`Revenue: ${money(revenue)}`,`Estimated Cost: ${money(cost)}`,`Gross Profit: ${money(revenue-cost)}`]};
}

/*
 PURPOSE:
 Opens reports on screen instead of downloading immediately.
*/
function bindReports(){
  document.querySelectorAll('[data-report]').forEach(card=>card.addEventListener('click',async()=>{
    const type=card.dataset.report;
    try{
      if(type==='stock')return showReportViewer(buildStockReportModel());
      if(type==='expiry')return showReportViewer(buildExpiryReportModel());
      if(type==='customer')return showReportViewer(buildCustomerReportModel());
      if(type==='purchase')return showReportViewer(buildPurchaseReportModel());

      if(!navigator.onLine)return toast('Sales and profit reports require server connection.','warning');
      const data=await api(`/api/reports/sales?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);
      showReportViewer(type==='profit'?buildProfitReportModel(data):buildSalesReportModel(data));
    }catch(e){
      toast(e.message,'error');
    }
  }));
}

/* PURPOSE: Makes it clear that reports open first and PDF is optional. */
function reportsView(){
  return `<div class="page-header"><div><h1>Reports</h1><p>Open reports on screen, then save or print as PDF</p></div></div>
  <div class="report-pdf-note">Click a report to <b>view it first</b>. From the viewer you can choose <b>Save PDF</b> or <b>Print</b>.</div>
  <div class="report-cards">
    <div class="report-card green" data-report="sales"><span>📈 Sales Report</span><small>View report</small></div>
    <div class="report-card blue" data-report="purchase"><span>🛒 Purchase Report</span><small>View report</small></div>
    <div class="report-card orange" data-report="stock"><span>📦 Stock Report</span><small>View report</small></div>
    <div class="report-card red" data-report="expiry"><span>📅 Expiry Report</span><small>View report</small></div>
    <div class="report-card purple" data-report="profit"><span>◔ Profit & Loss</span><small>View report</small></div>
    <div class="report-card teal" data-report="customer"><span>👥 Customer Report</span><small>View report</small></div>
  </div>`;
}


/* ============================================================================
 DIRECT PDF DOWNLOAD + TABLE CUSTOMER LOOKUP — v6.1
 PURPOSE:
 Guarantees Customer Lookup uses real table rows and Save PDF downloads a PDF file
 directly without using the browser print dialog.
 REFERENCE:
 Local jsPDF assets are loaded from this app using versioned URLs to bypass stale
 browser/service-worker cache entries.
============================================================================ */

/*
 PURPOSE:
 Dynamically loads one local script exactly once.
 REFERENCE:
 Version query strings prevent stale cached assets from blocking a new release.
*/
function loadLocalScript(src,globalTest){
  return new Promise((resolve,reject)=>{
    if(globalTest())return resolve();

    const existing=[...document.scripts].find(s=>s.src.includes(src.split('?')[0]));
    if(existing){
      existing.addEventListener('load',()=>globalTest()?resolve():reject(new Error('PDF script loaded but did not initialize.')),{once:true});
      existing.addEventListener('error',()=>reject(new Error('Unable to load local PDF script.')),{once:true});
      setTimeout(()=>{if(globalTest())resolve();},0);
      return;
    }

    const script=document.createElement('script');
    script.src=src;
    script.async=false;
    script.onload=()=>globalTest()?resolve():reject(new Error('PDF script loaded but did not initialize.'));
    script.onerror=()=>reject(new Error('Unable to load local PDF script.'));
    document.head.appendChild(script);
  });
}

/*
 PURPOSE:
 Ensures the locally bundled jsPDF and AutoTable libraries are available before
 generating any report PDF.
 REFERENCE:
 This does not require internet access.
*/
async function ensurePdfLibraries(){
  await loadLocalScript('/lib/jspdf.umd.min.js?v=6.1',()=>Boolean(window.jspdf?.jsPDF));
  await loadLocalScript('/lib/jspdf.plugin.autotable.min.js?v=6.1',()=>Boolean(window.jspdf?.jsPDF?.API?.autoTable));

  if(!window.jspdf?.jsPDF)throw new Error('Local jsPDF library could not be loaded.');
  if(!window.jspdf.jsPDF.API?.autoTable)throw new Error('Local PDF table library could not be loaded.');
}

/*
 PURPOSE:
 Downloads the report directly as a .pdf file.
 REFERENCE:
 No browser print dialog is used. If local PDF assets fail to load, the user sees
 an error instead of being redirected into printing.
*/
async function saveReportPdf(report){
  try{
    await ensurePdfLibraries();

    const JsPdf=window.jspdf.jsPDF;
    const doc=new JsPdf({orientation:'landscape',unit:'mm',format:'a4'});
    const headerBottom=appState.settings?.address?36:31;

    doc.autoTable({
      head:[report.headers],
      body:report.rows.map(row=>row.map(v=>String(v??''))),
      startY:headerBottom+4,
      margin:{top:headerBottom+4,left:14,right:14,bottom:15},
      styles:{fontSize:8,cellPadding:2.3,overflow:'linebreak'},
      headStyles:{fillColor:[13,94,145],textColor:255,fontStyle:'bold'},
      alternateRowStyles:{fillColor:[246,249,252]},
      didDrawPage:()=>drawCompanyPdfHeader(doc,report.title)
    });

    let y=(doc.lastAutoTable?.finalY||headerBottom)+8;
    if(report.summary?.length){
      if(y>185){
        doc.addPage();
        drawCompanyPdfHeader(doc,report.title);
        y=42;
      }
      doc.setFont('helvetica','bold');
      doc.setFontSize(10);
      report.summary.forEach(line=>{
        doc.text(String(line),14,y);
        y+=6;
      });
    }

    const pageCount=doc.internal.getNumberOfPages();
    for(let i=1;i<=pageCount;i++){
      doc.setPage(i);
      const width=doc.internal.pageSize.getWidth();
      const height=doc.internal.pageSize.getHeight();
      doc.setFont('helvetica','normal');
      doc.setFontSize(8);
      doc.text(`Page ${i} of ${pageCount}`,width-14,height-7,{align:'right'});
    }

    doc.save(report.filename);
    toast('PDF saved directly.','success');
  }catch(error){
    console.error(error);
    toast(`PDF download failed: ${error.message}`,'error');
  }
}


/* ============================================================================
 POS WORKSPACE REDESIGN — v6.2
 PURPOSE:
 Rebuilds the POS Sales workspace around the approved modern pharmacy mockup while
 preserving barcode, batch, quantity, directions, patient, cashier and offline logic.
 REFERENCE:
 Layout: patient strip → product search/table + cart → recent sales + quick actions.
============================================================================ */

/* PURPOSE: Returns unique non-empty product field values for POS filters. */
function posFilterValues(field){
  return [...new Set(appState.products.map(p=>String(p?.[field]||'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
}

/*
 PURPOSE:
 Renders the redesigned POS workstation.
 REFERENCE:
 Existing element IDs/data attributes are preserved where practical so existing
 workflows remain easy to maintain.
*/
function posView(){
  const subtotal=appState.cart.reduce((s,l)=>s+Number(l.quantity)*Number(l.unitPrice),0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const checkout=getCheckoutSettings();
  const categories=posFilterValues('category');
  const manufacturers=posFilterValues('manufacturer');
  const pendingCount=appState.cart.length;

  return `
  <div class="pos-workspace-v62">
    <div class="pos-v62-titlebar">
      <div class="pos-v62-title">
        <span class="pos-v62-title-icon">🛒</span>
        <div><h1>POS Sales</h1><p>Scan or search products, add to cart and complete sale.</p></div>
      </div>
      <div class="pos-v62-status">
        <span class="sync-pill">${navigator.onLine?'● Online':'● Offline'}</span>
        <span>${new Date().toLocaleDateString()} &nbsp; ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>

    ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode is active. Sales are stored locally and synchronize when the connection returns.</div>'}

    <section class="pos-v62-customer-strip">
      <div class="pos-v62-customer-icon">👤</div>
      <b>Customer / Patient</b>
      <div class="pos-v62-customer-data">
        <strong>${patient?esc(patient.name):'Walk-in Customer'}</strong>
        ${patient?`<span>(ID: #${patient.id})</span>`:''}
        ${patient?.phone?`<span>☎ ${esc(patient.phone)}</span>`:''}
        ${patient?.email?`<span>✉ ${esc(patient.email)}</span>`:''}
        ${patient?.allergies?`<span class="pos-v62-alert">Allergy: ${esc(patient.allergies)}</span>`:'<span class="pos-v62-ok">No alerts</span>'}
      </div>
      <div class="pos-v62-customer-actions">
        <button class="btn-primary" id="customerLookupBtn">⌕ Lookup</button>
        <button class="btn-light" id="quickAddPatientBtn">＋ New Patient</button>
        <button class="btn-light" id="clearCustomerBtn" ${patient?'':'disabled'}>👥 Walk-in</button>
      </div>
    </section>

    <div class="pos-v62-main-grid">
      <section class="panel pos-v62-products">
        <div class="panel-head"><span>💊 Product Search</span><span class="badge blue">Barcode Ready</span></div>
        <div class="panel-body">
          <div class="pos-v62-search-row">
            <div class="pos-v62-search-box">
              <span>⌕</span>
              <input id="posSearch" placeholder="Type product name, barcode, or RxNorm ID..." autocomplete="off">
            </div>
            <button class="btn-primary" id="posSearchBtn">Search</button>
          </div>

          <div class="pos-v62-filter-row">
            <select id="posCategoryFilter"><option value="">All Categories</option>${categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
            <select id="posManufacturerFilter"><option value="">All Manufacturers</option>${manufacturers.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
            <select id="posStockFilter"><option value="in">In Stock Only</option><option value="all">All Stock</option><option value="low">Low Stock ≤ 10</option></select>
            <button class="btn-light" id="clearProductFiltersBtn">Clear</button>
          </div>

          <div class="pos-v62-product-count" id="posProductCount">Showing ${appState.products.length} products</div>
          <div class="table-wrap pos-v62-product-table-wrap">
            <table class="data-table pos-v62-product-table">
              <thead><tr><th>Product</th><th>Strength</th><th>Form</th><th>Stock</th><th>Price</th><th>Action</th></tr></thead>
              <tbody>
              ${appState.products.slice(0,1000).map(p=>{
                const stock=stockForProduct(p.id);
                return `<tr class="pos-product-row" data-product-id="${p.id}" data-category="${esc(p.category||'')}" data-manufacturer="${esc(p.manufacturer||'')}" data-stock="${stock}">
                  <td><b>${esc(p.name)}</b><small>${esc(p.genericName||'')}</small></td>
                  <td>${esc(p.strength||'—')}</td>
                  <td>${esc(p.dosageForm||'—')}</td>
                  <td><b class="${Number(stock)<=10?'danger-text':'stock-good'}">${stock}</b></td>
                  <td>${money(p.sellingPrice)}</td>
                  <td><button class="btn-primary btn-xs" data-add-product="${p.id}">🛒 Add</button></td>
                </tr>`;
              }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel pos-v62-cart">
        <div class="panel-head">
          <span>🛒 Cart (${pendingCount} item${pendingCount===1?'':'s'})</span>
          <button class="btn-danger btn-xs" id="clearCartBtn">Clear Cart</button>
        </div>
        <div class="panel-body pos-v62-cart-body">
          <div class="table-wrap pos-v62-cart-table-wrap">
            <table class="data-table pos-v62-cart-table">
              <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead>
              <tbody>
                ${appState.cart.map((l,i)=>`<tr>
                  <td><b>${esc(l.productName)}</b><small>Batch ${esc(l.batchNo)} • Exp ${fmtDate(l.expiryDate)}</small>${l.directions?`<small class="directions-line">${esc(l.directions)}</small>`:''}</td>
                  <td>${money(l.unitPrice)}</td>
                  <td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}"></td>
                  <td><b>${money(Number(l.quantity)*Number(l.unitPrice))}</b></td>
                  <td class="nowrap">${l.directions?`<button class="btn-light btn-xs" title="Print directions" data-print-directions="${i}">🖨</button>`:''}<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td>
                </tr>`).join('')||'<tr><td colspan="5" class="empty">Cart is empty. Scan or add a product.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="pos-v62-totals">
            <div><span>Subtotal</span><b>${money(subtotal)}</b></div>
            <div><span>Discount</span><b>${money(0)}</b></div>
            <div class="pos-v62-total"><span>Total</span><strong>${money(subtotal)}</strong></div>
          </div>

          <div class="pos-v62-payment-block">
            <label>Payment Method</label>
            <div class="payment-row">${['Cash','Card','UPI','Split'].map(x=>`<button class="btn-light payment-btn ${appState.paymentMethod===x?'active':''}" data-payment="${x}">${x}</button>`).join('')}</div>
          </div>

          <div class="pos-v62-checkout-grid">
            <button class="pos-v62-pay-here" id="payHereBtn" ${appState.cart.length?'':'disabled'}>
              <b>💳 Pay Here</b><span>Complete payment at this station</span>
            </button>
            <button class="pos-v62-send-cashier" id="sendCashierBtn" ${appState.cart.length?'':'disabled'}>
              <b>👥 Send to Cashier</b><span>Order complete • Payment Pending</span>
            </button>
          </div>

          <div class="pos-v62-secondary-actions">
            <button class="btn-light" id="holdSaleBtn">Ⅱ Hold Sale</button>
            <button class="btn-light" id="printBtn">🖨 Print</button>
            <span>Default: <b>${checkout.defaultRoute==='cashier'?'Send to Cashier':'Pay Here'}</b></span>
          </div>
        </div>
      </section>
    </div>

    <div class="pos-v62-bottom-grid">
      <section class="panel">
        <div class="panel-head"><span>◷ Recent Sales</span><button class="btn-light btn-xs" id="viewAllSalesBtn">View Reports</button></div>
        <div class="panel-body" id="posRecentSales">
          <div class="empty">${navigator.onLine?'Loading recent sales...':'Recent server sales unavailable offline.'}</div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><span>⚡ Quick Actions</span></div>
        <div class="panel-body">
          <div class="pos-v62-quick-actions">
            <button data-pos-quick="stock"><span>▣</span><b>Stock Check</b></button>
            <button data-pos-quick="price"><span>🏷</span><b>Price Check</b></button>
            <button data-pos-quick="hold"><span>Ⅱ</span><b>Hold Sale</b></button>
            <button data-pos-quick="customer"><span>👤</span><b>Customer</b></button>
            <button data-pos-quick="cashier"><span>💵</span><b>Cashier</b></button>
          </div>
        </div>
      </section>
    </div>
  </div>`;
}

/* PURPOSE: Applies product search/filter controls and updates the visible count. */
function filterPosProducts(){
  const q=String(document.getElementById('posSearch')?.value||'').trim().toLowerCase();
  const category=document.getElementById('posCategoryFilter')?.value||'';
  const manufacturer=document.getElementById('posManufacturerFilter')?.value||'';
  const stockMode=document.getElementById('posStockFilter')?.value||'in';
  let visible=0;

  document.querySelectorAll('.pos-product-row').forEach(row=>{
    const p=appState.products.find(x=>String(x.id)===row.dataset.productId);
    const stock=Number(row.dataset.stock||0);
    const text=`${p?.name||''} ${p?.genericName||''} ${p?.barcode||''} ${p?.rxNormId||''}`.toLowerCase();
    const matchText=!q||text.includes(q);
    const matchCategory=!category||String(p?.category||'')===category;
    const matchManufacturer=!manufacturer||String(p?.manufacturer||'')===manufacturer;
    const matchStock=stockMode==='all'||(stockMode==='in'&&stock>0)||(stockMode==='low'&&stock>0&&stock<=10);
    const show=matchText&&matchCategory&&matchManufacturer&&matchStock;
    row.style.display=show?'':'none';
    if(show)visible++;
  });

  const count=document.getElementById('posProductCount');
  if(count)count.textContent=`Showing ${visible} of ${appState.products.length} products`;
}

/* PURPOSE: Loads the latest invoices into the POS Recent Sales block. */
async function loadPosRecentSales(){
  const host=document.getElementById('posRecentSales');
  if(!host||!navigator.onLine)return;

  try{
    const data=await api(`/api/reports/sales?tenantId=${appState.session.tenantId}&branchId=${appState.session.branchId}`);
    const sales=(data.sales||[]).slice(0,5);
    host.innerHTML=sales.length?`
      <div class="table-wrap"><table class="data-table pos-v62-recent-table">
        <thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${sales.map(s=>{
          const customer=appState.customers.find(c=>c.id===Number(s.customerId));
          const pending=String(s.paymentMethod||'').startsWith('PENDING::');
          return `<tr><td>${new Date(s.createdUtc).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td><td><b>${esc(s.invoiceNo)}</b></td><td>${esc(customer?.name||'Walk-in')}</td><td>${money(s.total)}</td><td><span class="badge ${pending?'orange':'green'}">${pending?'Pending':'Paid'}</span></td></tr>`;
        }).join('')}</tbody>
      </table></div>`
      : '<div class="empty">No recent sales yet.</div>';
  }catch(e){
    host.innerHTML='<div class="empty">Unable to load recent sales.</div>';
  }
}

/*
 PURPOSE:
 Wires the redesigned POS without changing its underlying business flow.
*/
function bindPos(){
  const search=document.getElementById('posSearch');

  search?.addEventListener('input',filterPosProducts);
  document.getElementById('posCategoryFilter')?.addEventListener('change',filterPosProducts);
  document.getElementById('posManufacturerFilter')?.addEventListener('change',filterPosProducts);
  document.getElementById('posStockFilter')?.addEventListener('change',filterPosProducts);

  search?.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    e.preventDefault();
    const value=String(search.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filterPosProducts();
    }else{
      filterPosProducts();
    }
  });

  document.getElementById('posSearchBtn')?.addEventListener('click',()=>{
    const value=String(search?.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
    }
    filterPosProducts();
  });

  document.getElementById('clearProductFiltersBtn')?.addEventListener('click',()=>{
    if(search)search.value='';
    const category=document.getElementById('posCategoryFilter'); if(category)category.value='';
    const manufacturer=document.getElementById('posManufacturerFilter'); if(manufacturer)manufacturer.value='';
    const stock=document.getElementById('posStockFilter'); if(stock)stock.value='in';
    filterPosProducts();
    search?.focus();
  });

  document.querySelectorAll('[data-add-product]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    appState.selectedProductId=Number(btn.dataset.addProduct);
    showBatchSelectionModal(appState.selectedProductId);
  });
  document.querySelectorAll('.pos-product-row').forEach(row=>row.ondblclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });

  document.getElementById('customerLookupBtn')?.addEventListener('click',showPosCustomerLookup);
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));
  document.getElementById('clearCustomerBtn')?.addEventListener('click',()=>{appState.selectedCustomerId=null;render();toast('Walk-in Customer selected.');});

  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.onclick=()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)]));

  document.querySelectorAll('[data-payment]').forEach(btn=>btn.onclick=()=>{appState.paymentMethod=btn.dataset.payment;render();});
  document.getElementById('payHereBtn')?.addEventListener('click',()=>completeSale('here'));
  document.getElementById('sendCashierBtn')?.addEventListener('click',()=>completeSale('cashier'));
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());

  const holdCurrentSale=()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({id:Date.now(),cart:appState.cart,paymentMethod:appState.paymentMethod,customerId:appState.selectedCustomerId});
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    render();
    toast('Sale held locally.');
  };
  document.getElementById('holdSaleBtn')?.addEventListener('click',holdCurrentSale);

  document.querySelectorAll('[data-pos-quick]').forEach(btn=>btn.onclick=()=>{
    const action=btn.dataset.posQuick;
    if(action==='stock'){appState.view='stock';render();return;}
    if(action==='price'){search?.focus();search?.select();return;}
    if(action==='hold'){holdCurrentSale();return;}
    if(action==='customer'){showPosCustomerLookup();return;}
    if(action==='cashier'){appState.view='cashier';render();return;}
  });

  document.getElementById('viewAllSalesBtn')?.addEventListener('click',()=>{appState.view='reports';render();});

  filterPosProducts();
  loadPosRecentSales();
  setTimeout(()=>search?.focus(),0);
}


/* ============================================================================
 PAY-HERE METHOD POPUP + HELD SALE RECALL — v6.5
 PURPOSE:
 Removes the always-visible payment-method buttons from POS. Pay Here now asks for
 Cash/Card/UPI/Split in a modal. Held orders can be recalled back into the cart.
============================================================================ */

/*
 PURPOSE:
 Shows payment choices only when Pay Here is selected.
 REFERENCE:
 Keeps the main POS cleaner and reduces accidental payment-method selection.
*/
function showPayHereMethodModal(){
  if(!appState.cart.length){
    toast('Cart is empty.','warning');
    return;
  }

  const total=appState.cart.reduce((s,l)=>s+Number(l.quantity)*Number(l.unitPrice),0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const host=document.createElement('div');
  host.className='modal-backdrop';

  host.innerHTML=`
    <div class="modal pay-method-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">Select Payment Method</b>
          <div class="muted">${patient?esc(patient.name):'Walk-in Customer'} • Total ${money(total)}</div>
        </div>
        <button class="close-btn" id="payMethodClose">×</button>
      </div>
      <div class="modal-body">
        <div class="pay-method-total">
          <span>Amount Due</span>
          <strong>${money(total)}</strong>
        </div>
        <div class="pay-method-grid">
          <button type="button" data-pay-method="Cash"><span>💵</span><b>Cash</b><small>Cash payment</small></button>
          <button type="button" data-pay-method="Card"><span>💳</span><b>Card</b><small>Debit / credit card</small></button>
          <button type="button" data-pay-method="UPI"><span>📱</span><b>UPI</b><small>Digital payment</small></button>
          <button type="button" data-pay-method="Split"><span>➗</span><b>Split</b><small>Multiple methods</small></button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="payMethodCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(host);

  const close=()=>host.remove();
  document.getElementById('payMethodClose').onclick=close;
  document.getElementById('payMethodCancel').onclick=close;

  host.querySelectorAll('[data-pay-method]').forEach(btn=>btn.onclick=async()=>{
    appState.paymentMethod=btn.dataset.payMethod;
    close();
    await completeSale('here');
  });
}

/*
 PURPOSE:
 Opens the locally held orders list and lets the cashier restore one order.
 REFERENCE:
 Held orders are stored in localStorage and remain available after refresh.
*/
function showHeldOrdersModal(){
  const held=Array.isArray(appState.heldSales)?appState.heldSales:[];
  const host=document.createElement('div');
  host.className='modal-backdrop';

  host.innerHTML=`
    <div class="modal wide held-orders-modal">
      <div class="modal-head">
        <div>
          <b class="batch-modal-title">Recall Held Order</b>
          <div class="muted">${held.length} held order${held.length===1?'':'s'} on this station.</div>
        </div>
        <button class="close-btn" id="heldOrdersClose">×</button>
      </div>
      <div class="modal-body">
        ${held.length?`
          <div class="table-wrap">
            <table class="data-table held-orders-table">
              <thead><tr><th>Held Time</th><th>Customer</th><th>Items</th><th>Total</th><th>Action</th></tr></thead>
              <tbody>
                ${held.map((h,i)=>{
                  const customer=appState.customers.find(c=>c.id===Number(h.customerId));
                  const total=(h.cart||[]).reduce((s,l)=>s+Number(l.quantity)*Number(l.unitPrice),0);
                  const qty=(h.cart||[]).reduce((s,l)=>s+Number(l.quantity||0),0);
                  return `<tr>
                    <td>${new Date(h.id).toLocaleString()}</td>
                    <td><b>${esc(customer?.name||'Walk-in Customer')}</b></td>
                    <td>${qty}</td>
                    <td><b>${money(total)}</b></td>
                    <td class="nowrap">
                      <button class="btn-primary btn-xs" data-recall-held="${i}">Recall</button>
                      <button class="btn-danger btn-xs" data-delete-held="${i}">Delete</button>
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>`
          : '<div class="empty">No held orders on this station.</div>'}
      </div>
      <div class="modal-foot">
        <button class="btn-light" id="heldOrdersCancel">Close</button>
      </div>
    </div>`;

  document.body.appendChild(host);
  const close=()=>host.remove();
  document.getElementById('heldOrdersClose').onclick=close;
  document.getElementById('heldOrdersCancel').onclick=close;

  host.querySelectorAll('[data-recall-held]').forEach(btn=>btn.onclick=()=>{
    const index=Number(btn.dataset.recallHeld);
    const order=appState.heldSales[index];
    if(!order)return;

    if(appState.cart.length){
      toast('Clear or hold the current cart before recalling another order.','warning');
      return;
    }

    appState.cart=(order.cart||[]).map(x=>({...x}));
    appState.paymentMethod=order.paymentMethod||'Cash';
    appState.selectedCustomerId=order.customerId||null;
    appState.heldSales.splice(index,1);
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    close();
    render();
    toast('Held order recalled.','success');
  });

  host.querySelectorAll('[data-delete-held]').forEach(btn=>btn.onclick=()=>{
    const index=Number(btn.dataset.deleteHeld);
    appState.heldSales.splice(index,1);
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    close();
    showHeldOrdersModal();
  });
}

/*
 PURPOSE:
 v6.5 POS layout removes payment-method buttons and adds Recall Held Order.
*/
function posView(){
  const subtotal=appState.cart.reduce((s,l)=>s+Number(l.quantity)*Number(l.unitPrice),0);
  const patient=appState.customers.find(c=>c.id===Number(appState.selectedCustomerId));
  const checkout=getCheckoutSettings();
  const categories=posFilterValues('category');
  const manufacturers=posFilterValues('manufacturer');
  const heldCount=Array.isArray(appState.heldSales)?appState.heldSales.length:0;

  return `
  <div class="pos-workspace-v62">
    <div class="pos-v62-titlebar">
      <div class="pos-v62-title">
        <span class="pos-v62-title-icon">🛒</span>
        <div><h1>POS Sales</h1><p>Scan or search products, add to cart and complete sale.</p></div>
      </div>
      <div class="pos-v62-status">
        <span class="sync-pill">${navigator.onLine?'● Online':'● Offline'}</span>
        <span>${new Date().toLocaleDateString()} &nbsp; ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      </div>
    </div>

    ${navigator.onLine?'':'<div class="offline-banner">Offline sale mode is active. Sales are stored locally and synchronize when the connection returns.</div>'}

    <section class="pos-v62-customer-strip">
      <div class="pos-v62-customer-icon">👤</div>
      <b>Customer / Patient</b>
      <div class="pos-v62-customer-data">
        <strong>${patient?esc(patient.name):'Walk-in Customer'}</strong>
        ${patient?`<span>(ID: #${patient.id})</span>`:''}
        ${patient?.phone?`<span>☎ ${esc(patient.phone)}</span>`:''}
        ${patient?.email?`<span>✉ ${esc(patient.email)}</span>`:''}
        ${patient?.allergies?`<span class="pos-v62-alert">Allergy: ${esc(patient.allergies)}</span>`:'<span class="pos-v62-ok">No alerts</span>'}
      </div>
      <div class="pos-v62-customer-actions">
        <button class="btn-primary" id="customerLookupBtn">⌕ Lookup</button>
        <button class="btn-light" id="quickAddPatientBtn">＋ New Patient</button>
        <button class="btn-light" id="clearCustomerBtn" ${patient?'':'disabled'}>👥 Walk-in</button>
      </div>
    </section>

    <div class="pos-v62-main-grid">
      <section class="panel pos-v62-products">
        <div class="panel-head"><span>💊 Product Search</span><span class="badge blue">Barcode Ready</span></div>
        <div class="panel-body">
          <div class="pos-v62-search-row">
            <div class="pos-v62-search-box"><span>⌕</span><input id="posSearch" placeholder="Type product name, barcode, or RxNorm ID..." autocomplete="off"></div>
            <button class="btn-primary" id="posSearchBtn">Search</button>
          </div>
          <div class="pos-v62-filter-row">
            <select id="posCategoryFilter"><option value="">All Categories</option>${categories.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
            <select id="posManufacturerFilter"><option value="">All Manufacturers</option>${manufacturers.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
            <select id="posStockFilter"><option value="in">In Stock Only</option><option value="all">All Stock</option><option value="low">Low Stock ≤ 10</option></select>
            <button class="btn-light" id="clearProductFiltersBtn">Clear</button>
          </div>
          <div class="pos-v62-product-count" id="posProductCount">Showing ${appState.products.length} products</div>
          <div class="table-wrap pos-v62-product-table-wrap">
            <table class="data-table pos-v62-product-table">
              <thead><tr><th>Product</th><th>Strength</th><th>Form</th><th>Stock</th><th>Price</th><th>Action</th></tr></thead>
              <tbody>${appState.products.slice(0,1000).map(p=>{
                const stock=stockForProduct(p.id);
                return `<tr class="pos-product-row" data-product-id="${p.id}" data-category="${esc(p.category||'')}" data-manufacturer="${esc(p.manufacturer||'')}" data-stock="${stock}">
                  <td><b>${esc(p.name)}</b><small>${esc(p.genericName||'')}</small></td>
                  <td>${esc(p.strength||'—')}</td><td>${esc(p.dosageForm||'—')}</td>
                  <td><b class="${Number(stock)<=10?'danger-text':'stock-good'}">${stock}</b></td>
                  <td>${money(p.sellingPrice)}</td>
                  <td><button class="btn-primary btn-xs" data-add-product="${p.id}">🛒 Add</button></td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel pos-v62-cart">
        <div class="panel-head">
          <span>🛒 Cart (${appState.cart.length} item${appState.cart.length===1?'':'s'})</span>
          <button class="btn-danger btn-xs" id="clearCartBtn">Clear Cart</button>
        </div>
        <div class="panel-body pos-v62-cart-body">
          <div class="table-wrap pos-v62-cart-table-wrap">
            <table class="data-table pos-v62-cart-table">
              <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th><th></th></tr></thead>
              <tbody>
                ${appState.cart.map((l,i)=>`<tr>
                  <td><b>${esc(l.productName)}</b><small>Batch ${esc(l.batchNo)} • Exp ${fmtDate(l.expiryDate)}</small>${l.directions?`<small class="directions-line">${esc(l.directions)}</small>`:''}</td>
                  <td>${money(l.unitPrice)}</td>
                  <td><input class="cart-qty" data-cart-index="${i}" type="number" min="1" max="${l.maxQty}" value="${l.quantity}"></td>
                  <td><b>${money(Number(l.quantity)*Number(l.unitPrice))}</b></td>
                  <td class="nowrap">${l.directions?`<button class="btn-light btn-xs" data-print-directions="${i}">🖨</button>`:''}<button class="btn-danger btn-xs" data-remove-cart="${i}">×</button></td>
                </tr>`).join('')||'<tr><td colspan="5" class="empty">Cart is empty. Scan or add a product.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="pos-v62-totals">
            <div><span>Subtotal</span><b>${money(subtotal)}</b></div>
            <div><span>Discount</span><b>${money(0)}</b></div>
            <div class="pos-v62-total"><span>Total</span><strong>${money(subtotal)}</strong></div>
          </div>

          <div class="pos-v62-checkout-grid">
            <button class="pos-v62-pay-here" id="payHereBtn" ${appState.cart.length?'':'disabled'}>
              <b>💳 Pay Here</b><span>Choose payment method next</span>
            </button>
            <button class="pos-v62-send-cashier" id="sendCashierBtn" ${appState.cart.length?'':'disabled'}>
              <b>👥 Send to Cashier</b><span>Order complete • Payment Pending</span>
            </button>
          </div>

          <div class="pos-v62-secondary-actions">
            <button class="btn-light" id="holdSaleBtn">Ⅱ Hold Sale</button>
            <button class="btn-light" id="recallHeldBtn">↩ Recall Held${heldCount?` (${heldCount})`:''}</button>
            <button class="btn-light" id="printBtn">🖨 Print</button>
            <span>Default: <b>${checkout.defaultRoute==='cashier'?'Send to Cashier':'Pay Here'}</b></span>
          </div>
        </div>
      </section>
    </div>

    <div class="pos-v62-bottom-grid">
      <section class="panel">
        <div class="panel-head"><span>◷ Recent Sales</span><button class="btn-light btn-xs" id="viewAllSalesBtn">View Reports</button></div>
        <div class="panel-body" id="posRecentSales"><div class="empty">${navigator.onLine?'Loading recent sales...':'Recent server sales unavailable offline.'}</div></div>
      </section>
      <section class="panel">
        <div class="panel-head"><span>⚡ Quick Actions</span></div>
        <div class="panel-body">
          <div class="pos-v62-quick-actions">
            <button data-pos-quick="stock"><span>▣</span><b>Stock Check</b></button>
            <button data-pos-quick="price"><span>🏷</span><b>Price Check</b></button>
            <button data-pos-quick="hold"><span>Ⅱ</span><b>Hold Sale</b></button>
            <button data-pos-quick="recall"><span>↩</span><b>Recall Held</b></button>
            <button data-pos-quick="cashier"><span>💵</span><b>Cashier</b></button>
          </div>
        </div>
      </section>
    </div>
  </div>`;
}

/*
 PURPOSE:
 v6.5 bindings: Pay Here opens payment popup and held orders can be recalled.
*/
function bindPos(){
  const search=document.getElementById('posSearch');

  search?.addEventListener('input',filterPosProducts);
  document.getElementById('posCategoryFilter')?.addEventListener('change',filterPosProducts);
  document.getElementById('posManufacturerFilter')?.addEventListener('change',filterPosProducts);
  document.getElementById('posStockFilter')?.addEventListener('change',filterPosProducts);

  search?.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    e.preventDefault();
    const value=String(search.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
      filterPosProducts();
    }else filterPosProducts();
  });

  document.getElementById('posSearchBtn')?.addEventListener('click',()=>{
    const value=String(search?.value||'').trim();
    const exact=appState.products.some(p=>String(p.barcode||'').trim().toLowerCase()===value.toLowerCase());
    if(exact){
      handlePosBarcodeScan(value);
      search.value='';
    }
    filterPosProducts();
  });

  document.getElementById('clearProductFiltersBtn')?.addEventListener('click',()=>{
    if(search)search.value='';
    const category=document.getElementById('posCategoryFilter'); if(category)category.value='';
    const manufacturer=document.getElementById('posManufacturerFilter'); if(manufacturer)manufacturer.value='';
    const stock=document.getElementById('posStockFilter'); if(stock)stock.value='in';
    filterPosProducts();
    search?.focus();
  });

  document.querySelectorAll('[data-add-product]').forEach(btn=>btn.onclick=e=>{
    e.stopPropagation();
    appState.selectedProductId=Number(btn.dataset.addProduct);
    showBatchSelectionModal(appState.selectedProductId);
  });
  document.querySelectorAll('.pos-product-row').forEach(row=>row.ondblclick=()=>{
    appState.selectedProductId=Number(row.dataset.productId);
    showBatchSelectionModal(appState.selectedProductId);
  });

  document.getElementById('customerLookupBtn')?.addEventListener('click',showPosCustomerLookup);
  document.getElementById('quickAddPatientBtn')?.addEventListener('click',()=>showPersonModal('customer'));
  document.getElementById('clearCustomerBtn')?.addEventListener('click',()=>{appState.selectedCustomerId=null;render();toast('Walk-in Customer selected.');});

  document.getElementById('clearCartBtn')?.addEventListener('click',()=>{appState.cart=[];render();});
  document.querySelectorAll('[data-remove-cart]').forEach(btn=>btn.onclick=()=>{appState.cart.splice(Number(btn.dataset.removeCart),1);render();});
  document.querySelectorAll('.cart-qty').forEach(input=>input.onchange=()=>{
    const item=appState.cart[Number(input.dataset.cartIndex)];
    item.quantity=Math.max(1,Math.min(Number(input.value)||1,item.maxQty));
    render();
  });
  document.querySelectorAll('[data-print-directions]').forEach(btn=>btn.onclick=()=>printDirectionLabel(appState.cart[Number(btn.dataset.printDirections)]));

  document.getElementById('payHereBtn')?.addEventListener('click',showPayHereMethodModal);
  document.getElementById('sendCashierBtn')?.addEventListener('click',()=>completeSale('cashier'));
  document.getElementById('printBtn')?.addEventListener('click',()=>printCurrentBill());

  const holdCurrentSale=()=>{
    if(!appState.cart.length)return toast('Cart is empty.','warning');
    appState.heldSales.push({
      id:Date.now(),
      cart:appState.cart.map(x=>({...x})),
      paymentMethod:appState.paymentMethod,
      customerId:appState.selectedCustomerId
    });
    localStorage.setItem('pharmacare.heldSales',JSON.stringify(appState.heldSales));
    appState.cart=[];
    appState.selectedCustomerId=null;
    render();
    toast('Sale held locally.');
  };

  document.getElementById('holdSaleBtn')?.addEventListener('click',holdCurrentSale);
  document.getElementById('recallHeldBtn')?.addEventListener('click',showHeldOrdersModal);

  document.querySelectorAll('[data-pos-quick]').forEach(btn=>btn.onclick=()=>{
    const action=btn.dataset.posQuick;
    if(action==='stock'){appState.view='stock';render();return;}
    if(action==='price'){search?.focus();search?.select();return;}
    if(action==='hold'){holdCurrentSale();return;}
    if(action==='recall'){showHeldOrdersModal();return;}
    if(action==='cashier'){appState.view='cashier';render();return;}
  });

  document.getElementById('viewAllSalesBtn')?.addEventListener('click',()=>{appState.view='reports';render();});

  filterPosProducts();
  loadPosRecentSales();
  setTimeout(()=>search?.focus(),0);
}
