# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions are `major.minor` (0.1, 0.2, …; package.json holds them as 0.1.0, 0.2.0).

## [0.5] - 2026-10-20

Getting around a map is quicker: press / to find anything on it, and the URL now names what's open, so a link brings someone to the same place. The page also explains a missing map, and two fixes stop a blank page and a confusing python3 error.

### Highlights

- Press `/` or the Find button to jump to any block, part, function or file on the map.
- The page URL names what's open, so a link reopens the map at the same place; a Copy link button copies it, and browser back/forward step through what you opened.

### Added

- Press `?` to open a sheet listing every key, gesture and button.
- When three.js or WebGL can't load, the page says why the map is missing instead of staying blank.

### Fixed

- A map whose title holds a line break or `</script>` renders instead of showing a blank page, and the title can no longer inject markup into the page.
- An old python3 is reported as too old, not as `python3 failed: EPIPE`.

## [0.4] - 2026-10-16

The README shows what a map looks like, with an animated tour and screenshots, and a bigger example, the Corner Shop monorepo, is there to try repo mode on.

### Highlights

- The README, on GitHub and on npm, shows what a map looks like: an animated tour, and pictures of the three levels, a walkthrough, the branch view and an architecture.
- A bigger example to try repo mode on, `examples/corner-shop`: an invented shop monorepo with a Next.js storefront and back office, TypeScript packages over Prisma, and two Python Lambda services on DynamoDB and S3, with two branches to compare. From a clone: `node bin/archivision.js repo examples/corner-shop --open`.

### For contributors

- `node scripts/readme-media.mjs` makes the README pictures again from the examples, in a headless Chrome (needs Google Chrome and ffmpeg).

## [0.3] - 2026-10-16

archivision is on npm: npm install -g archivision.

### Highlights

- `npm install -g archivision` installs it from npm: `archivision` (and `birdview`, the old name) go on your PATH. The package holds only what runs (about 240 KB), with TypeScript as its one dependency.

## [0.2] - 2026-10-16

birdview is now archivision, and open source under the MIT licence. Everything you had keeps working under the old names.

### Highlights

- archivision is open source under the MIT licence, at github.com/Giamme/archivision. Every page it writes carries its licences (archivision's and iso-glow's) in a comment in its head.
- birdview is now **archivision**: the command is `archivision repo|arch|render`, pages are written as `<name>.archivision.html`, and `ARCHIVISION_RIPWIRE` names ripwire for Go. The old names keep working: `birdview` runs the same commands, `BIRDVIEW_RIPWIRE` is still read, and a map saved next to an old page (`<repo>.birdview.map.json`) carries over with its edits on the first run.

### Fixed

- `archivision render x.birdview.arch.json` writes `x.archivision.html`; it used to write `x.birdview.birdview.html`.
- With a `python3` older than 3.10, the page now says that is why the Python files were not read; it used to say only that python3 failed. archivision needs Python 3.10 or later for Python repos.

## [0.1] - 2026-10-15

The first version: a 3D isometric map of a codebase, read with no AI and linked to its exact lines, or of an architecture, drawn from documents and diagrams through the AI CLIs you already use. Reads TypeScript, JavaScript, Python and, with ripwire, Go.

### Highlights

- `birdview repo <path>` maps a TypeScript repo into one self-contained 3D isometric page with no AI: Next.js App Router routes, Prisma models and their uses, Vitest and Playwright tests, grouped into blocks and parts by fixed rules, with walkthroughs that follow real calls down to a data write. Every block, part, function and walkthrough step links to its exact lines on GitHub (at the scanned commit) or in VS Code or Cursor. The grouping is saved to `<page>.map.json`, so renames and regrouping by hand survive the next run (`--remap` starts over). Press **b** on the page to see what a branch changes (`--bases`, `--compare base..head`; nothing is fetched unless you pass `--fetch`).
- `birdview arch <docs>` turns architecture documents and diagrams (Markdown, Mermaid, draw.io, images, PDFs) into the same kind of map, through the Claude Code or Codex CLI you are already logged in to: no API key is ever asked for. `--ai auto` tries Claude Code, then Codex. The model is checked against a strict schema, repaired where it can be, and saved as `.arch.json` to edit by hand; `birdview render` redraws it.

### Added

- Monorepos and JavaScript: each workspace package (`package.json` workspaces, `pnpm-workspace.yaml`, `apps/*`, `packages/*`) is read with its own `tsconfig.json` or `jsconfig.json`, calls across packages resolve, and JavaScript and CommonJS go through the same compiler pass. `--src` picks the code roots by hand. A **Coverage** section on the page counts the files mapped per language and those left out, and where, plus the calls not followed.
- Repos and packages without app routes (libraries, API-only services) are grouped by their folders, and walkthroughs start from any entry point when a repo has fewer than three pages: route handlers, server actions, middleware.
- Cables say **calls** when code on one side calls the other and **uses** when it only uses a value from it (a constant, a client, a function passed on), and their links go to every call site. Calls include `new`, tagged templates, decorators, JSX elements and same-file calls; a call to a method a subclass overrides is inferred.
- The page says how sure it is: a cable that is not exact is dashed, and a walkthrough says when it is inferred or not traced. Only exact references feed walkthroughs and the blast radius. For developers, `lib/scan-schema.js` is the written scan contract (version 2): every fact carries the adapter that found it and a status (`exact`, `inferred`, `ambiguous`, `unresolved`).
- Python: `.py` files are read with Python's own `ast` (the `python3` on your PATH, run isolated, never importing the scanned code): symbols, calls with how sure each is, imports, pytest and unittest files. Data access is mapped too: boto3 DynamoDB, S3 and SQS, SQL tables named by DB-API cursors, SQLAlchemy and Django models.
- Deployments: `serverless.yml` (with `${file(…)}` includes), SAM templates and Dockerfile `CMD`s give Lambda handlers and their triggers (routes, schedules, events), and the environment variables that name buckets and tables. What the reader cannot follow is listed in the Coverage section.
- Go: with ripwire 0.6.7 installed (`--ripwire <binary>`, `BIRDVIEW_RIPWIRE` or the PATH), `.go` files give functions, types, interfaces, methods on their types, constants and variables, each checked against birdview's own reading of the text. There are no calls between them yet, and the page says so. Without ripwire the Go files are counted, not read.
- Mapping a repo never changes it, not even git's index, and its own git configuration cannot make the scan run anything (hooks, filters, external diff drivers, textconv, fsmonitor, lazy fetch). Symlinks that leave the repo are not followed.
- `npm run check -- page.html` clicks through any page offline (every block, part, walkthrough and branch) and checks every code link against the file and line it points to.
