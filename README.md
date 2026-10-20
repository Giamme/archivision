# archivision

A 3D isometric map you can open, in the iso-glow style, of a codebase or of an architecture. It works two ways:

![archivision on an example shop: the map flies in, opens the Orders package and one of its parts, plays a walkthrough from the checkout page to the stock table, then shows what a branch changes](https://raw.githubusercontent.com/Giamme/archivision/main/media/tour.webp)


- **`archivision repo`** reads a TypeScript, JavaScript, Python or Go repo and maps it **with no AI**. Parsers find the files, functions, calls, data stores (Prisma tables; DynamoDB tables, S3 buckets, SQS queues and SQL tables from Python), Lambda handlers, tests and branch changes. A fixed set of rules groups them into blocks and parts. Every block, part, function, cable and walkthrough step links to the exact lines on GitHub (at the scanned commit) or in VS Code or Cursor.
- **`archivision arch`** reads architecture documents and diagrams (Markdown, Mermaid, draw.io, images, PDFs…) and has a model turn them into the same kind of map. The model runs through the AI CLIs you are already logged in to (Claude Code or Codex); archivision never asks for an API key. It has no code links, but keeps the blocks, parts, pieces, cables, an optional numbered bus and walkthroughs.

Each run writes one HTML page, with everything inline except three.js, which it loads from a CDN. Open it in a browser: click a block to open it, click a part to go one level deeper, press space to play a walkthrough. On repo pages, press **b** to see what a branch changes.

```bash
npm install -g archivision
archivision repo path/to/a/repo --open
archivision arch docs/ --name "My system" --open
```

The first maps a repo of yours; the second has an AI CLI draw an architecture from the documents and diagrams in `docs/`. The project was first called birdview, and `birdview` still runs the same commands.

From a clone, with the example architecture:

```bash
git clone https://github.com/Giamme/archivision.git && cd archivision
npm install
node bin/archivision.js render examples/shop/shop.arch.json --open
node bin/archivision.js arch examples/shop/architecture.md --name "Corner Shop" --open
```

`render` draws the example model as it is; `arch` has the AI draw it again from its source document. `node bin/archivision.js repo examples/corner-shop --open` maps the same shop's code: an invented monorepo with a Next.js storefront and back office, TypeScript packages over Prisma, and two Python Lambda services. `npm link` puts `archivision` on your PATH.

**Needs** Node 20 or later and git. Optional: Python 3.10 or later (`python3`) for Python repos, ripwire 0.6.7 for Go, the `claude` (Claude Code) or `codex` CLI, logged in, for architecture mode, and `pdftotext` for PDFs.

## What a map shows

All of these are the Corner Shop example (`examples/corner-shop` and `examples/shop`).

**Three levels.** The whole repo is a plate of blocks. Open a block to see its parts inside it, and a part to see its functions, files and tests, each linked to its lines.

![Three levels of the same map: the whole repo; the Orders package open, with its Logic, Config and Data access parts; its Logic part open, with the functions reserveOrder, releaseOrder, onPaymentSucceeded, onPaymentFailed and startWorker](https://raw.githubusercontent.com/Giamme/archivision/main/media/levels.webp)

**Walkthroughs.** Each one follows real calls from a page, an API route or a Lambda handler down to the code that writes the data, one step per call, each step linked to its line.

![The walkthrough from the checkout page to the stock table, lit across the Checkout, Actions, Orders and Catalog blocks, with its eight steps listed beside the map](https://raw.githubusercontent.com/Giamme/archivision/main/media/journey.webp)

**Branches.** Press **b** to compare two branches: the blocks that hold the changes light up, and dashed arcs come from the code that calls what changed.

![The branch view comparing feature/gift-cards with dev: 9 files changed, the Orders, Checkout, Actions and Payments blocks lit, dashed arcs from their callers](https://raw.githubusercontent.com/Giamme/archivision/main/media/branches.webp)

**Architecture.** `archivision arch` draws the same kind of map from documents and diagrams: here the Corner Shop's architecture document, with its services, outside providers, event bus and walkthroughs.

![The Corner Shop architecture: twelve blocks for the shop, back office, auth, catalog, orders, payments, fulfilment and notifier services, Postgres, Stripe, Sendcloud and Postmark, with five walkthroughs listed](https://raw.githubusercontent.com/Giamme/archivision/main/media/architecture.webp)

## Repo mode (no AI)

```bash
archivision repo <path> [--out page.html] [--map map.json] [--remap]
                        [--bases dev,main] [--since 60] [--max 24] [--compare base..head,…] [--fetch]
                        [--ripwire <binary>]
```

**What it reads**
- TypeScript and JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`) in the code roots: `--src` when given; else each workspace package's `src/` (or the package folder, when it has no `src/` with code) and the repo's `src/`; with neither, the whole repo. `tests/`, `test/`, `__tests__/`, `browser-tests/` and `e2e/` next to the repo or a package are test roots. They are read through the TypeScript compiler API, with the nearest `tsconfig.json` or `jsconfig.json` and its paths. A file outside every root that the code imports (a script a test imports) is read too, for its symbols and calls, but not placed on the map; the Coverage section counts it. Next.js App Router routes come from the `app/` folder of each code root, `.well-known/` included; other dot-folders are skipped.
- `prisma/schema.prisma` and every `prisma.<model>.<op>` call.
- `.py` files, through Python's own `ast` (`python3` on the PATH, never one inside the repo): symbols, calls with how sure each is, imports, and data access (boto3 DynamoDB, S3 and SQS; DB-API cursors and the tables their SQL names, read as tokens, with each statement's own target written; SQLAlchemy and Django models, known by bases traced through the imports). Libraries are recognised by what the code imports, never by a name alone; a call or a query on a value whose type the scan does not know is counted, not drawn. Python runs isolated (`-I -S -B`, the files sent on stdin, from a folder outside the repo) and never imports the scanned code. Without `python3`, or with one older than 3.10, the Python files are counted as not read, and the page says why.
- Deployment manifests, read as text: `serverless.yml` (functions, handlers, images, events, environment), SAM templates and Dockerfile `CMD`s. Each Lambda handler is configured (found), conventional (`lambda_handler(event, context)` that no manifest names) or unresolved, with the reason; HTTP events are routes, schedules jobs, the rest events. A bucket or table named by an environment variable takes the value the deployments running that code give it (a function's own value over its provider's) when they agree on a literal, else `$NAME`. CloudFormation tags (`!Ref`, `!Sub`) are never names. `${file(…)}` includes of functions are followed inside the repo; what the reader cannot follow (an alias, a merge key, a flow collection that does not close, a second YAML document, functions given by a tag, an include outside the repo) is listed in the Coverage section.
- `.go` files, through ripwire's language server when you have it (`--ripwire`, else `ARCHIVISION_RIPWIRE`, else `ripwire` on the PATH; never one inside the repo, only at a version archivision knows, 0.6.7, run from a private temporary folder with its own HOME): functions, types, interfaces, methods on their types, constants and variables, each checked against archivision's own reading of the text. No calls between them yet: ripwire gives none, and archivision invents none. Without ripwire the Go files are counted, not read.
- Vitest files that import a part; pytest and unittest files and what they import.
- Playwright specs under `e2e/` that visit a part's pages.

The scan changes nothing in the repo it maps, neither its files nor its `.git`. The page and its map are written to the current folder (or to `--out`), so run it from outside the repo, or give `--out`, to keep them out of it. `--fetch` is the one exception: it runs `git fetch --prune`, which updates the repo's remote branches.

**How it groups, with no AI**
- Route segments become blocks; big routes split one level.
- Name stems and imports attach the other files.
- Part kinds come from the file types, and zones follow the order a request flows.
- Each table group belongs to the block that writes it most.
- Walkthroughs follow real calls from a page, or from an API route or a Lambda handler in repos without pages, down to a data write.

**The map file** (`<page>.map.json`, next to the page) holds that grouping: blocks, parts, globs, names, zones, table groups and walkthroughs.
- The first run writes it; later runs reuse it, so renames and regrouping by hand stick.
- `--remap` writes it again from the code.
- `--map other.json` uses a map from somewhere else, for example one an LLM wrote.
- Every glob and anchor is checked against the parse on each build; anything that no longer matches is reported.

**Branches**
- The scanner compares each base (`--bases`, default `dev,main,master`, local or `origin/`) with every branch active in the last `--since` days, up to `--max` branches. Add more pairs with `--compare`.
- It never fetches unless you pass `--fetch`.
- On the page, **b** opens the branch view, with **Base** and **Compare** pickers and a swap button. The view lights the blocks, parts and functions that changed, dashes the callers of the changed code, and links each file to its GitHub diff.

**Links**: GitHub at the scanned commit when it is pushed; otherwise VS Code. Viewers can switch to VS Code or Cursor and set their own checkout path; both settings are saved in their browser.

## Architecture mode (AI)

```bash
archivision arch <files or folders…> [--out page.html] [--name "System"] [--ai auto|claude|codex]
                                      [--model id] [--effort low|medium|high|xhigh|max] [--focus "…"]
archivision render <model.arch.json> [--out page.html]
```

**Sources**
- Text: `.md .txt .mmd .puml .dot .d2 .json .yaml .prisma .graphql .proto`.
- HTML: tags stripped, Mermaid blocks kept.
- SVG: text labels.
- draw.io: boxes, containers and labelled arrows, compressed or not.
- Images: `.png .jpg .webp .gif`.
- PDFs.

Folders are read recursively, skipping `node_modules`, `.git` and build folders.

**Backends**: only CLIs, each with its own login; no API keys. `--ai auto` tries them in this order and skips any that is not installed or not logged in.

| Backend | Needs | Default model | Notes |
|---|---|---|---|
| `claude` | the `claude` CLI (Claude Code), logged in | `opus` | `claude -p --output-format json --json-schema …`. It cannot run commands, edit, write or browse (`--disallowedTools`); it may read files, which is how it sees image and PDF sources (their folders are added with `--add-dir`). |
| `codex` | the `codex` CLI, logged in | `gpt-6-astra` | `codex exec -s read-only --output-schema …`; images attached with `--image`. |

PDFs go in as text when `pdftotext` is installed; otherwise the CLI reads the file itself.

**What comes out**
- `<page>.arch.json`: the model, checked and repaired.
- The page.

The check fixes what it safely can and lists each repair:
- ids, kinds and duplicates;
- links and flows to unknown things;
- parts outside any zone;
- port numbers and walkthrough steps.

It also prints what the sources left open (`unclear`). Edit the `.arch.json` by hand and run `archivision render` to redraw it without calling a model.

**The model** (`lib/arch/schema.js`): `title`, `intro`, `layers`, `modules` (each with `zones`, `parts` with `kind`, `children` (pieces) and `links`), `flows` between blocks, an optional `bus` with numbered `ports` and the blocks on each, `journeys` (steps at blocks, parts or `P<n>` ports) and `unclear`. Parts may also carry `col`, `row`, `cspan` and `rspan` to pin their cell. `examples/shop/architecture.md` is a small source document to try the AI on, and `examples/shop/shop.arch.json` is the model Codex drew from it.

## The page

- One HTML file. It loads three.js 0.160.0 from jsDelivr the first time it opens; everything else is inline.
- Controls (press **?** on the page, or its **?** button, for the full list):
  - **click** opens a block or part;
  - **ⓘ** or **i** explains it;
  - **← →** move between blocks;
  - **enter** opens;
  - **space** plays the next walkthrough;
  - **b** shows branches (repo pages);
  - **/** finds a block, part, function or file by its name or path, and flies to it;
  - **esc** goes back.
- The toolbar has **Iso view** (true isometric), **Revolve**, the light and dark theme, and the accent colour.
- `?still` opens without the intro camera move; `?branch` opens in the branch view.
- The address ends in `#` and the id of what is open (a block, a part, a function), so a link to the page opens it again, with no tour. **Copy link** in the bar copies it; the ids come from the map, so links keep working while the map does not change.

## Development

```bash
npm test                        # repo mode on fixture git repos, the scan contract, goldens, no writes and no hostile git config, architecture mode, the CLI; pages clicked through offline
npm run check -- page.html      # click through any page offline: every block and part, links, branches, walkthroughs
```

The full suite needs Python 3.10 or later. The Go tests that run ripwire itself skip unless ripwire 0.6.7 is on the PATH or named by `ARCHIVISION_RIPWIRE`. `node scripts/readme-media.mjs` makes the pictures above again from the examples, in a headless Chrome (it needs Google Chrome and ffmpeg). `ARCHIVISION_ACCEPT=/path/to/repo,/path/to/other npm test` also checks your own repos: every code root holds exactly the code git lists, and every file is either mapped or counted.

`test/check-page.mjs` runs the real page module and three.js in jsdom with WebGL stubbed: no browser, no downloads. On a repo page it also opens every code link's file and line on disk.

Layout:
- `lib/repo/scan/`: the scanner, one adapter per source of facts:
  - `discover` finds the packages and code roots: `--src` when given, else each workspace package's `src/` (or its folder), else `src/`, else the whole repo; and counts every file it leaves out;
  - `tsc` reads TypeScript through the compiler: symbols, the references between files, and every call with every place it is made, same-file calls, `new` and JSX elements included;
  - `next` reads Next.js routes and entry points;
  - `prisma` reads models and their uses;
  - `python` runs `python/scan.py` (Python's `ast`) for Python symbols, calls, imports and data access; `manifests` reads serverless.yml, SAM and Dockerfiles; `lambda` turns them into handlers and triggers;
  - `ripwire` runs ripwire's language server for Go symbols, and `go` reads Go declarations from the text to check them;
  - `playwright` reads e2e visits;
  - `compare` reads branch changes;
  - `git` runs read-only git with argument lists, so the scanned repo's hooks, filters and diff drivers never run.
- `lib/scan-schema.js`: the scan contract, version 2, as a JSON Schema with its own small validator. Every fact carries its adapter (`prov`) and a status (`exact`, `inferred`, `ambiguous` or `unresolved`).
- `lib/repo/facts.js`: the only reader of the contract's shape. `automap.js` and `build.js` work from its views.
- On the page a cable says **calls** when code on one side calls the other, and **uses** when it only uses a value from it: a constant, a schema, a function passed on. Its links go to the calls when there are any.
- `lib/arch/`: `schema.js`, `prompt.js`, `inputs.js`, `ai.js`, `model.js`.
- `lib/layout.js`: the plate both modes share.
- `lib/page.js`: assembles the page.
- `assets/`: the iso-glow 3D shell and the archivision figure module.

## Limits

- Repo mode reads TypeScript and JavaScript (`.ts .tsx .mts .cts .js .jsx .mjs .cjs`), Python (`.py`) and, with ripwire, Go (`.go`: symbols, no calls or data yet). Other languages are counted, not mapped: the page's **Coverage** section says how many files of each it left out, and where, and what it could not follow. Walkthroughs need data calls to end at; repos without any get no rail and no walkthroughs.
- Python: `self.m()` is never exact (an instance can be changed at run time), a call to a decorated function is inferred (unless the decorator is one that returns what it decorates, by its import: `staticmethod`, `typing.final`, …), and a name bound more than once (a def in two branches, an import then an assignment) gives ambiguous calls to each binding. Methods follow Python's C3 order; a call on a Protocol or to an abstract method is counted, not drawn to every implementation, and subclasses outside the repo are not seen. A `sys.path` edit with a literal relative path is relative to where the program runs, which the code does not say: inferred. A boto3 call on a client passed in, or a table name built at run time, is counted, not drawn. No call between a trigger and code is invented: an S3 event names its bucket, not the code that wrote to it.
- A monorepo's packages are found from `package.json` workspaces, `pnpm-workspace.yaml`, or `apps/*` and `packages/*`. A package without app routes is a district of its own. Several Next.js apps in one repo are not told apart yet.
- Branch comparisons see only the refs present locally (run with `--fetch`, or fetch yourself).
- The AI never invents code links: architecture pages have none. A model can still misread a source, so read the repairs and the `unclear` list, and fix the `.arch.json` when needed.

## Licence

MIT: see `LICENSE`. Credits for the third-party work it includes or loads are in `NOTICE`. What changed in each version is in `CHANGELOG.md`.
