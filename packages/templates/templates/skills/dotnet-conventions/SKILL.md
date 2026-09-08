---
id: dotnet-conventions
name: .NET stack conventions
version: 1.0.0
description: >
  Layout, error, logging and testing conventions for a .NET service. Thin and generic by design --
  an organisation's own overlay is the real source of truth once one exists.
when_to_use: >
  Any task that creates or modifies C#/.NET source.
applies_to:
  agents: [backend, reviewer, sdet]
  languages: [csharp, dotnet]
activation: auto
budget_tokens: 800
forge_version: '>=1.0 <2'
---

## Layout

One solution, projects split by feature/bounded-context rather than by layer
(`Acme.Billing.Api`/`Acme.Billing.Domain`/`Acme.Billing.Data`, not `Acme.Controllers`/
`Acme.Services`). `Directory.Build.props`/`Directory.Packages.props` for centralised, pinned package
versions across the solution.

## Errors

Custom exception types for domain errors; middleware-level exception handling maps them to problem-
details responses at the API boundary, not scattered try/catch per controller action. Nullable
reference types enabled solution-wide -- a state a null check would hide should be unrepresentable,
not defended against ad hoc.

## Logging

Structured logging via `ILogger` with message templates
(`_logger.LogInformation("Order {OrderId} placed", orderId)`, never string interpolation into the
message) so fields stay queryable, not baked into an opaque string. `Activity`/`ActivitySource` (or
the project's OpenTelemetry SDK) for trace propagation across async boundaries.

## Testing

xUnit (or the project's chosen framework) with `Testcontainers.NET` for real-dependency integration
tests. `dotnet test --blame` to isolate a flaky test's own failure rather than losing it in a
parallel run's combined output.

## Do not

- Do not use `async void` outside an event handler -- exceptions thrown inside it cannot be caught
  by the caller and will crash the process.
- Do not suppress a nullable-reference warning with `!` without a comment stating why the value is
  actually guaranteed non-null there.
