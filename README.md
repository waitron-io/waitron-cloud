# Waitron Cloud

Waitron Cloud is a commercial, closed-source product that provides cloud services
for venues running Waitron, including remote access, backups, recovery, hosted
instances, bookings and reporting.

The product is being designed. Start with the [product and platform discussion](docs/product-and-platform.md),
then the [cloud backlog](docs/backlog.md). The [documentation ownership map](docs/documentation-ownership.md)
records the material moved from Waitron and the shared designs that remain there.
The [Waitron integration contract](docs/waitron-integration-contract.md) maps registration,
service configuration and recovery to the existing interfaces and the incoming SQLite work.

## Development

Use Node.js 24 or later and pnpm 9.15.0 to work in this repository. Install
dependencies from the lockfile with:

```sh
pnpm install --frozen-lockfile
```

The root package is private. Add build and test scripts when you add the first
application package.
