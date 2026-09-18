# Architecture

## Single application

`PharmaCarePOS.csproj` is an ASP.NET Core .NET 8 application. It serves:

- static SPA/PWA UI from `wwwroot`
- JSON API endpoints from `Program.cs`
- Microsoft SQL Server data through EF Core

This deliberately avoids the earlier two-process client/API setup.

## SaaS isolation

Every pharmacy operational entity includes `TenantId`; branch stock also includes `BranchId`. Production must enforce tenant filtering from authenticated claims on the server rather than accepting tenant IDs from query/body data as this demo does.

## Offline POS

The service worker caches the application shell. IndexedDB stores the working catalogue and `pendingSales`. Sales use a client-generated operation ID for idempotent retry.

## Conflict policy

Server stock is authoritative. If an offline sale reaches the server and its batch no longer has enough stock, the API returns HTTP 409 and the sale remains in the browser queue for review.

## Recommended production topology

Cloud SaaS:

Browser/PWA -> ASP.NET Core API -> SQL Server/PostgreSQL

For branches requiring multi-terminal operation during WAN outages:

POS browsers -> Branch Edge API/DB over LAN -> Cloud SaaS when WAN returns
