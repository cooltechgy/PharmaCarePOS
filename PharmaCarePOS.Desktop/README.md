# PharmaCare POS Desktop (WPF) — v7.7

This is the native Windows desktop edition of PharmaCare POS.

## Architecture

- WPF windows and controls only. No WebView and no webpage rendering.
- Uses the existing ASP.NET Core API at http://localhost:5001.
- Uses SQLite under the Windows user's LocalAppData folder for offline caching.
- POS sales are written to SQLite first, then synchronized to POST /api/sales.
- Existing ClientOperationId idempotency on the API protects reconnect retries from intentional duplicate invoices.

## First run

1. Start the existing PharmaCarePOS ASP.NET Core server.
2. Confirm the API is available at http://localhost:5001.
3. Run PharmaCarePOS.Desktop.
4. Sign in once while online so the session/catalogue can be cached.
5. If the server/internet later becomes unavailable, sign in with the same credential and continue POS selling offline.

Demo:
- Username: admin
- Password: Admin123!

## Offline-capable now

- Cached staff login after one successful online login
- Dashboard stock/expiry fallback
- Product catalogue/search
- Barcode scan + Enter
- FEFO batch selection
- Cart and local stock deduction
- Pay Here sale queue
- Send to Cashier sale queue
- Automatic retry/synchronization
- Products list
- Stock list
- Customer list
- Expiry list

## Online-only in this first desktop build

- Cashier payment completion
- Purchase posting
- Reports
- User/role administration
- Settings changes

Those online-only modules already have native desktop navigation positions for the next build.
