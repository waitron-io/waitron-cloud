# Waitron Cloud

Waitron Cloud is a commercial, closed-source product that provides cloud services
for venues running Waitron, including remote access, backups, recovery, hosted
instances, bookings and reporting.

The first internal registration package is implemented; no Cloud service is deployed. Start with the [product and platform discussion](docs/product-and-platform.md),
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

Check types and run the registration tests against a disposable PostgreSQL container
(requires Docker):

```sh
pnpm typecheck
pnpm test
```

See [registration development](packages/registration/README.md) for the trust boundary,
migrations and test setup. The workspace packages are private. Public registration,
login and service provisioning are still to be implemented.
