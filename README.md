# PharmaCarePOS v4.3 - MSSQL Settings Fix

This build fixes the Settings page controls. General, Invoice, Users, Backup and System tabs now have working handlers.

# PharmaCare POS v2 — corrected single-project build

This version replaces the earlier split client/API starter with **one ASP.NET Core .NET 8 application**. One process serves both the UI and API.

## What is functional

- Colorful pharmacy dashboard matching the supplied reference style more closely.
- POS medicine search.
- Batch selection and expiry display.
- FEFO batch ordering (earliest valid expiry first).
- Cart quantities and payment method selection.
- Offline-first completed sales using IndexedDB.
- Automatic pending-sale synchronization when the browser comes back online.
- Duplicate retry protection using `ClientOperationId` and a unique database index.
- Server stock conflict detection.
- Product list and working Add Product form.
- Purchase/GRN entry that creates or increases a batch.
- Batch-wise stock screen.
- Expiry / near-expiry report.
- Customers and suppliers screens.
- Report menu.
- Settings screen.
- SaaS owner screen for tenants and plans.

## Requirements

Install **.NET 8 SDK**.

## Windows — easiest start

Double-click:

`start.bat`

Then open:

`http://localhost:5080`

## macOS / Linux

```bash
./start.sh
```

Then open `http://localhost:5080`.

## Manual start

```bash
dotnet restore
dotnet run --urls http://localhost:5080
```

## Demo login

Pharmacy:

- Tenant: `pharmacare`
- Username: `admin`
- Password: `Admin123!`

SaaS platform:

- Tenant: `platform`
- Username: `superadmin`
- Password: `SaaS123!`

## How offline sales work

1. An online login downloads products, batches, customers and suppliers.
2. The browser stores that data in IndexedDB.
3. When internet is unavailable, the POS can still search cached medicines and complete sales.
4. A completed sale is written to `pendingSales` in IndexedDB **before** any upload is attempted.
5. Cached batch quantity is reduced locally so the cashier sees the local effect immediately.
6. When the `online` browser event fires, pending sales are POSTed to `/api/sales`.
7. The server checks `ClientOperationId` so a retry does not create the same invoice twice.
8. The server re-checks the batch and stock quantity before accepting the sale.
9. If another till used the stock while this till was offline, the sale remains queued with a conflict instead of silently overwriting server stock.

## Important multi-till note

Browser-only offline mode keeps **one terminal** operational during an internet outage. If several tills must continue sharing the same live stock while the WAN is down, add a **branch edge server / LAN database**. The central SaaS database cannot coordinate multiple disconnected browsers while the internet is physically unavailable.

## Production work still required

This package is a functional development/demo base, not a certified pharmacy production product. Before live deployment add ASP.NET Core Identity/MFA, platform-admin authorization policies, database migrations, audit logs, encrypted secrets, tax/local invoice rules, returns/refunds, stock adjustments, branch transfers, full purchase headers/history, backup/restore, subscription billing integration, conflict-resolution UI, printer integrations and deployment monitoring.

## Code comments

Major models, API endpoints, functions and offline operations contain `PURPOSE` and `REFERENCE` comment blocks so a beginner can follow the code.

## v4 functional correction

This package includes `PharmaCarePOS.sln` for Visual Studio and connects controls that were visual-only in v2. Product editing, customer/supplier add-edit, stock batch adjustment, CSV exports, tenant settings persistence, recent sales/profit reports, POS hold sale, purchase cancellation, and manual synchronization now have working handlers/endpoints.

The project targets .NET 8. Open `PharmaCarePOS.sln` in Visual Studio 2022, restore NuGet packages, and press F5, or run `start.bat`.


## V4 additions
- New Item opens instantly with a blank form (no data-loading dependency).
- Detailed patient/customer medical record: DOB, sex, address, allergies, conditions, current medicines, doctor, emergency contact and notes.
- POS patient selection links invoices to patient medicine history.
- Patient Medical Record screen shows all linked medicine purchases.
- Every medicine has a Sales History button.
- RxNorm import endpoint/button imports active SCD/SBD concepts.
- Medicine image URL support plus DailyMed image lookup per RxNorm medicine.
- The application now uses Microsoft SQL Server. By default it connects to Visual Studio LocalDB instance `(localdb)\MSSQLLocalDB` and creates database `PharmaCarePOS`.

### Medicine catalogue source
RxNorm import uses the U.S. National Library of Medicine RxNorm REST API. DailyMed image lookup only fills an image when published label media exists; not every medicine has an image.


## Microsoft SQL Server local database

Version 4.2 uses **Microsoft SQL Server** instead of SQLite.

Default connection string in `appsettings.json`:

```text
Server=(localdb)\\MSSQLLocalDB;Database=PharmaCarePOS;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true
```

### Option A - Visual Studio LocalDB (recommended for local development)

1. Install Visual Studio 2022 with the **ASP.NET and web development** workload.
2. Make sure **SQL Server Express LocalDB** is installed in Visual Studio Installer -> Individual components.
3. Open `PharmaCarePOS.sln`.
4. Restore NuGet packages.
5. Press F5.
6. The application calls `Database.EnsureCreatedAsync()` at startup. If `PharmaCarePOS` does not exist, SQL Server LocalDB creates it automatically.

You can view the database in Visual Studio under **View -> SQL Server Object Explorer -> (localdb)\MSSQLLocalDB -> Databases -> PharmaCarePOS**.

### Option B - SQL Server Express

If you use SQL Server Express instead of LocalDB, change the `Default` connection string to:

```text
Server=.\\SQLEXPRESS;Database=PharmaCarePOS;Trusted_Connection=True;TrustServerCertificate=True;MultipleActiveResultSets=true
```

### Option C - Local SQL Server with SQL username/password

Example only:

```text
Server=localhost;Database=PharmaCarePOS;User Id=sa;Password=YOUR_PASSWORD;TrustServerCertificate=True;MultipleActiveResultSets=true
```

Do not commit a real production password to source control. Use environment variables or ASP.NET Core user secrets for real deployments.

### Reset the local database

Because this development build uses `EnsureCreatedAsync()`, if the schema changes during development, delete the `PharmaCarePOS` database in SQL Server Object Explorer and run the application again. It will recreate and reseed the database.
