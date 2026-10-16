# Roadmap

Goal: `archivision repo` works on as many stacks as possible, not only TypeScript, Next.js and Prisma.

Only the scanner depends on the stack. Grouping, the build and the page all work on one neutral scan:
- files;
- symbols with their lines;
- calls, with the place each call is made;
- routes and other entry points;
- data access;
- tests.

So every new stack is an adapter that fills that scan. The scan is a written contract (version 2, in `lib/scan-schema.js`), and every fact in it says which adapter found it and how sure it is.

## Where it stands (0.2)

- TypeScript and JavaScript through the compiler, with every call and the place it is made; monorepos and workspace packages.
- Next.js App Router routes, Prisma models and their uses, Vitest and Playwright tests.
- Python through its own `ast`: symbols, calls with how sure each is, pytest and unittest; boto3, DB-API SQL, SQLAlchemy and Django data access.
- Lambda handlers and their triggers from `serverless.yml`, SAM templates and Dockerfiles.
- Go symbols through ripwire's language server, checked against archivision's own reading of the text. No Go calls yet.
- Repos without routes are grouped by their packages and folders.

## Next

1. **Go calls**: from a SCIP index (scip-go) where one exists, or ripwire's `--uses` edges, opt-in and marked inferred.
2. **Go entry points and data**: `net/http`, gin and chi routes; GORM and `database/sql`.
3. **Other JavaScript data layers**: Drizzle, TypeORM, Sequelize, raw SQL. Repos without Prisma then get the database rail too.
4. **Big flat folders**: a folder of a hundred components is one block today; clusters of imports would split it.
5. **Several Next.js apps in one repo**, told apart.

## Every stack: layered adapters

| Layer | What it gives the map | Sources, best first |
|---|---|---|
| Code graph | Pieces, code links, cables, blast radius | Our TypeScript compiler scanner for TS/JS (exact); our Python `ast` adapter; SCIP indexes where one exists (exact); for other languages, ripwire `--lsp` symbols and, opt-in, its `--uses` edges (inferred) |
| Entry points | Blocks and walkthrough starts | Per-framework detectors: Next.js, Remix, Express/Fastify/Nest, FastAPI/Flask/Django, Rails, Spring, Laravel, ASP.NET, Go net/http/gin/chi, AWS Lambda/serverless/SAM/CDK handlers |
| Data | The rail, walkthrough ends | Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django ORM, ActiveRecord, GORM, JPA/Hibernate, EF Core, raw SQL, AWS SDK (DynamoDB, S3, SQS) |
| Tests | Tests per part, untested gaps | Vitest, Jest, Playwright, pytest, go test, JUnit, RSpec, PHPUnit (ripwire's `--test-gate` already derives some runners) |
| Grouping fallback | Blocks when there are no routes | Packages and folders, then call-graph communities (ripwire `--communities`, Louvain) |
| Infra (later) | One map across services | docker-compose, Kubernetes, Terraform, serverless.yml |


## ripwire

ripwire (Red Hat, Apache-2.0, github.com/redhat-et/ripwire) is a C++ CLI that parses 25+ languages with tree-sitter and builds a call graph, offline and with no API key. archivision uses it for the languages it has no adapter of its own for, Go first, and pins the version it knows (0.6.7), because ripwire is pre-1.0 and its flags change quickly.

- **Symbols**: `--lsp` (`textDocument/documentSymbol`) gives complete symbols and spans quickly; archivision keeps each one only where its own reading of the text has the same declaration, line and kind.
- **Edges**: ripwire has no documented export of the whole call graph that is both complete and fast, and its edges are matched by name. LSP references are matched by name too, so they are not used for edges. `--uses=FILE:NAME` is the documented resolved route, one symbol at a time; it would come in opt-in, behind a filter for imports that shadow a name, and marked inferred.
- **Framework semantics**: routes and ORMs stay archivision's own detectors whatever ripwire gives.
