@echo off
REM PURPOSE: Starts the complete PharmaCare POS using one ASP.NET Core process.
REM REFERENCE: Requires the .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8.0
where dotnet >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: .NET 8 SDK is not installed or dotnet is not in PATH.
  echo Install .NET 8 SDK, then run this file again.
  pause
  exit /b 1
)
dotnet restore
if errorlevel 1 (
  echo.
  echo ERROR: NuGet restore failed. Check your internet connection for the first restore.
  pause
  exit /b 1
)
start "" http://localhost:5080
dotnet run --urls http://localhost:5080
pause
