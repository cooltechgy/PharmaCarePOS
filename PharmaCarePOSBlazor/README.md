# PharmaCarePOSBlazor

Blazor Web App version of PharmaCare POS.

## Architecture

- .NET 8 Blazor Web App
- Interactive Server render mode
- Reuses the existing PharmaCarePOS API and SQL Server database
- Default API URL: http://localhost:5001/
- Default Blazor URL: http://localhost:5002/

## Run

Start the existing API project first:

    dotnet run --project ../PharmaCarePOS.csproj --urls http://localhost:5001

Then start Blazor:

    dotnet run --project PharmaCarePOSBlazor.csproj --urls http://localhost:5002

Open http://localhost:5002.

The API URL can be changed in appsettings.json.
