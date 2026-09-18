#!/usr/bin/env bash
# PURPOSE: Starts the complete PharmaCare POS using one ASP.NET Core process.
# REFERENCE: Requires the .NET 8 SDK. First restore requires access to NuGet.
set -e
if ! command -v dotnet >/dev/null 2>&1; then
  echo "ERROR: .NET 8 SDK is not installed or dotnet is not in PATH."
  exit 1
fi
dotnet restore
dotnet run --urls http://localhost:5080
