#!/usr/bin/env python3
"""changelogger: changelog fragments, derived drafts, version bumps and release compilation.

Stdlib only, Python 3.9+. The agent workflow around these commands is described in ../SKILL.md.

Commands: init, status, new, skip, materialize, adopt, bump, compile, notes, check, release, vendor, hooks.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

SCRIPT = Path(__file__).resolve()
DIR = ".changelog"
UNRELEASED = f"{DIR}/unreleased"
TYPES = ("added", "changed", "deprecated", "removed", "fixed", "security")
TITLES = {t: t.capitalize() for t in TYPES}
# Any version-looking string, before a scheme is applied: 1.4, 1.4.2, 1.4.2.hotfix-1, 2.0.0-beta.1, 1.4.0+hotfix.1
VERSION_TEXT = r"\d+(?:\.\d+)+(?:[-.+][0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*)?"
VERSION_VALUE = re.compile(r"^\d+(?:\.\d+)*(?:[-.+][0-9A-Za-z]+(?:[-.][0-9A-Za-z]+)*)?$")
SEMVER_STRICT = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
                           r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$")
PEP440 = re.compile(  # lenient form accepted by Python packaging (non-normalized spellings allowed)
    r"^v?(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:[-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?[0-9]*)?"
    r"(?:-[0-9]+|[-_.]?(?:post|rev|r)[-_.]?[0-9]*)?(?:[-_.]?dev[-_.]?[0-9]*)?(?:\+[a-z0-9]+(?:[-_.][a-z0-9]+)*)?$",
    re.I)
PRE_SUFFIX = r"(?:-(?P<pre_label>[A-Za-z]+)\.(?P<pre_n>\d+))?"
PRESETS = {
    "semver": {"format": "{major}.{minor}.{patch}",
               "bump_rules": {"breaking": "major", "added": "minor", "default": "patch"}},
    "semver-hotfix": {"format": "{major}.{minor}.{patch}[.hotfix-{hotfix}]",
                      "bump_rules": {"breaking": "major", "added": "minor", "default": "patch"}},
    "two-part": {"format": "{major}.{minor}",
                 "bump_rules": {"breaking": "major", "added": "minor", "default": "minor"}},
    "build": {"format": "{major}.{minor}.{build}", "counter": "build",
              "bump_rules": {"breaking": "major", "added": "minor", "default": "build"}},
}
ECOSYSTEMS = {
    "semver": "npm, Cargo and Tauri require SemVer (X.Y.Z, optional -pre and +build)",
    "pep440": "Python packaging requires a PEP 440 version",
}
CONVENTIONAL = re.compile(r"^(?P<type>[A-Za-z]+)(?:\((?P<scope>[^)]*)\))?(?P<bang>!)?:\s*(?P<desc>\S.*)$")
TYPE_MAP = {
    "feat": "added", "feature": "added", "add": "added",
    "fix": "fixed", "bugfix": "fixed", "hotfix": "fixed",
    "perf": "changed", "change": "changed", "improve": "changed", "update": "changed",
    "deprecate": "deprecated", "remove": "removed", "security": "security",
}
DEFAULT_CONFIG = {
    "changelog": "CHANGELOG.md",
    "heading_format": "## [{version}] - {date}",
    "group_by_type": True,
    "tag_format": "v{version}",
    "version_files": [],
    "whats_new_path": None,
    "skip_types": ["build", "chore", "ci", "docs", "refactor", "style", "test", "tests"],
    "ignore": [
        r"^Merge (pull request|branch|remote-tracking branch) ",
        r"^chore\(release\)",
        r"^Release v?\d+\.\d+",
        r"^v?\d+(\.\d+)+\S*$",
        r"\[(skip|no) changelog\]",
    ],
    "normalize": [],
    "internal_label": "For contributors",
    "baseline": None,
}
def changelog_header(scheme_format: str) -> str:
    if scheme_format == PRESETS["semver"]["format"]:
        versions = "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)."
    else:
        versions = f"and versions follow the format `{scheme_format}` ([...] parts appear only when non-zero)."
    return ("# Changelog\n\nAll notable changes to this project are documented in this file.\n\n"
            "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),\n" + versions + "\n")
LOCKFILES = {
    "package-lock.json": "npm install --package-lock-only --ignore-scripts",
    "npm-shrinkwrap.json": "npm install --package-lock-only --ignore-scripts",
    "pnpm-lock.yaml": "pnpm install --lockfile-only",
    "yarn.lock": "yarn install --mode update-lockfile",
    "Cargo.lock": "cargo update --workspace --offline",
    "uv.lock": "uv lock",
    "poetry.lock": "poetry lock --no-update",
}
VERSION_FILE_NAMES = (
    "VERSION", "version.txt", "pyproject.toml", "package.json", "Cargo.toml",
    "setup.py", "plugin.json", "tauri.conf.json", "__init__.py",
)
TOML_VERSION_SECTIONS = {"project", "package", "workspace.package", "tool.poetry"}
HOOK_START = "# >>> changelogger >>>"
HOOK_END = "# <<< changelogger <<<"
HOOK_BLOCK = f"""{HOOK_START}
# Opt-in: writes a draft changelog fragment for commits made outside an agent session.
# Remove with `changelogger hooks off`.
cl_skip=
[ -n "$GIT_REFLOG_ACTION" ] && cl_skip=1
[ -n "$CLAUDECODE" ] && cl_skip=1
for cl_state in rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD MERGE_HEAD; do
  [ -e "$(git rev-parse --git-path "$cl_state")" ] && cl_skip=1
done
cl_bin="$(command -v changelogger 2>/dev/null || echo "$HOME/.local/bin/changelogger")"
if [ -z "$cl_skip" ] && [ -x "$cl_bin" ]; then
  (unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE; "$cl_bin" post-commit >/dev/null 2>&1) || true
fi
{HOOK_END}
"""


class Fail(Exception):
    """A user-facing error: printed without a traceback, exit code 2."""


# --------------------------------------------------------------------------- git


# Inside a git hook, git exports these for the repository it is committing to. Every git call below
# targets the repository in its cwd instead, so drop them before any child process inherits them.
for _var in ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"):
    os.environ.pop(_var, None)


def git(cwd: Path, *args: str, check: bool = True, input: Optional[str] = None) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=cwd, input=input,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        if check:
            raise Fail(f"git {' '.join(args)} failed: {proc.stderr.strip()}")
        return ""
    return proc.stdout.strip()


def git_ok(cwd: Path, *args: str) -> bool:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True).returncode == 0


class Repo:
    def __init__(self, start: Optional[str | Path] = None):
        start_path = Path(start or ".").resolve()
        top = git(start_path, "rev-parse", "--show-toplevel", check=False)
        if not top:
            raise Fail(f"{start_path} is not inside a git work tree")
        self.root = Path(top)
        self.dir = self.root / DIR
        self.unreleased = self.root / UNRELEASED
        self.released = self.dir / "released"
        self.config_path = self.dir / "config.json"
        self.json_path = self.dir / "changelog.json"
        self.skipped_path = self.unreleased / "skipped.txt"

    def git(self, *args: str, check: bool = True, input: Optional[str] = None) -> str:
        return git(self.root, *args, check=check, input=input)

    def ok(self, *args: str) -> bool:
        return git_ok(self.root, *args)

    def rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def has_head(self) -> bool:
        return self.ok("rev-parse", "--verify", "-q", "HEAD")

    @property
    def initialized(self) -> bool:
        return self.config_path.is_file()

    def config(self) -> dict:
        if not self.initialized:
            raise Fail(f"no {DIR}/config.json in {self.root}; run `changelogger init --dry-run` first")
        try:
            data = json.loads(self.config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise Fail(f"{DIR}/config.json is not valid JSON: {exc}") from exc
        return {**DEFAULT_CONFIG, **data}

    def tracked(self, *paths: str) -> list:
        out = self.git("ls-files", "--", *paths, check=False)
        return out.splitlines() if out else []


# ----------------------------------------------------------------------- commits


@dataclass
class Commit:
    sha: str
    short: str
    parents: list
    time: int
    subject: str
    body: str

    def matches(self, ref: str) -> bool:
        return bool(ref) and self.sha.startswith(ref.lower())


def list_commits(repo: Repo, revs: list) -> list:
    out = repo.git("log", "--no-color", "--format=%H%x1f%h%x1f%P%x1f%ct%x1f%s%x1f%b%x1e", *revs, check=False)
    commits = []
    for record in out.split("\x1e"):
        record = record.strip("\n")
        if not record.strip():
            continue
        sha, short, parents, ctime, subject, body = (record.split("\x1f") + [""] * 6)[:6]
        commits.append(Commit(sha.strip(), short, parents.split(), int(ctime or 0), subject, body.strip()))
    return commits


def changed_paths(repo: Repo, revs: list) -> dict:
    out = repo.git("log", "--no-color", "--format=%x1e%H", "--name-status", "--no-renames", *revs, check=False)
    result = {}
    for chunk in out.split("\x1e"):
        lines = [line for line in chunk.strip().splitlines() if line.strip()]
        if not lines:
            continue
        entries = []
        for line in lines[1:]:
            if "\t" in line:
                status, path = line.split("\t", 1)
                entries.append((status, path))
        result[lines[0].strip()] = entries
    return result


def resolve_subjects(repo: Repo, refs: list) -> dict:
    """Map each resolvable commit ref to its subject; refs whose objects are missing are dropped."""
    refs = sorted(set(r for r in refs if r))
    if not refs:
        return {}
    out = repo.git("cat-file", "--batch-check=%(objectname) %(objecttype)", input="\n".join(refs) + "\n", check=False)
    full = {}
    for ref, line in zip(refs, out.splitlines()):
        parts = line.split()
        if len(parts) == 2 and parts[1] == "commit":
            full[ref] = parts[0]
    if not full:
        return {}
    log = repo.git("log", "--no-walk=unsorted", "--format=%H%x1f%s", *sorted(set(full.values())), check=False)
    by_sha = dict(line.split("\x1f", 1) for line in log.splitlines() if "\x1f" in line)
    return {ref: by_sha[sha] for ref, sha in full.items() if sha in by_sha}


def short_sha(repo: Repo, ref: str) -> str:
    out = repo.git("rev-parse", "--short=7", "--verify", "-q", f"{ref}^{{commit}}", check=False)
    if not out:
        raise Fail(f"unknown commit {ref!r} in this repository")
    return out


# --------------------------------------------------------------------- fragments


@dataclass
class Fragment:
    path: Path
    type: str
    text: str
    breaking: bool = False
    audience: str = "user"
    commits: list = field(default_factory=list)
    draft: bool = False
    highlight: bool = False
    problems: list = field(default_factory=list)


def _truthy(value: Optional[str]) -> bool:
    return (value or "").strip().lower() in ("true", "yes", "1")


def parse_fragment(path: Path) -> Fragment:
    raw = path.read_text(encoding="utf-8")
    meta, body, problems = {}, raw, []
    lines = raw.splitlines()
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if end is None:
            problems.append("frontmatter is not closed with ---")
            end = 0
        for line in lines[1:end]:
            if ":" in line:
                key, value = line.split(":", 1)
                meta[key.strip().lower()] = value.split(" #", 1)[0].strip()
        body = "\n".join(lines[end + 1:])
    else:
        problems.append("missing --- frontmatter")
    ftype = meta.get("type", "").lower()
    if ftype not in TYPES:
        problems.append(f"type must be one of {', '.join(TYPES)} (got {ftype or 'nothing'})")
    audience = meta.get("audience", "user").lower() or "user"
    if audience not in ("user", "internal"):
        problems.append(f"audience must be user or internal (got {audience})")
    text = body.strip()
    if not text:
        problems.append("fragment has no text")
    return Fragment(
        path=path, type=ftype, text=text, breaking=_truthy(meta.get("breaking")), audience=audience,
        commits=[c for c in re.split(r"[,\s]+", meta.get("commits", "")) if c],
        draft=_truthy(meta.get("draft")), highlight=_truthy(meta.get("highlight")), problems=problems,
    )


def load_fragments(repo: Repo) -> list:
    if not repo.unreleased.is_dir():
        return []
    return [parse_fragment(p) for p in sorted(repo.unreleased.glob("*.md")) if p.name.lower() != "readme.md"]


def load_skipped(repo: Repo) -> list:
    if not repo.skipped_path.is_file():
        return []
    entries = []
    for line in repo.skipped_path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            sha, _, subject = line.partition("\t")
            entries.append((sha.strip().lower(), subject.strip()))
    return entries


def slugify(text: str, limit: int = 48) -> str:
    words = re.sub(r"[^a-z0-9]+", " ", text.lower()).split()
    slug = "-".join(words[:7])[:limit].strip("-")
    return slug or "change"


def render_fragment(ftype: str, text: str, commits: list, breaking: bool, audience: str, draft: bool,
                    highlight: bool = False) -> str:
    lines = ["---", f"type: {ftype}", f"breaking: {'true' if breaking else 'false'}", f"audience: {audience}",
             f"commits: {', '.join(commits)}"]
    if highlight:
        lines.append("highlight: true")
    if draft:
        lines.append("draft: true")
    lines += ["---", text.strip(), ""]
    return "\n".join(lines)


def write_fragment(repo: Repo, ftype: str, text: str, commits: list, breaking: bool = False,
                   audience: str = "user", draft: bool = False, when: Optional[dt.datetime] = None,
                   slug: Optional[str] = None, highlight: bool = False) -> Path:
    if ftype not in TYPES:
        raise Fail(f"--type must be one of {', '.join(TYPES)}")
    if not text.strip():
        raise Fail("fragment text is empty")
    repo.unreleased.mkdir(parents=True, exist_ok=True)
    stamp = (when or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = f"{stamp}-{slugify(slug or text)}"
    path, n = repo.unreleased / f"{base}.md", 2
    while path.exists():
        path, n = repo.unreleased / f"{base}-{n}.md", n + 1
    path.write_text(render_fragment(ftype, text, commits, breaking, audience, draft, highlight), encoding="utf-8")
    return path


# ------------------------------------------------------------------- derivation


@dataclass
class Draft:
    type: str
    text: str
    breaking: bool
    commits: list  # Commit, newest first

    @property
    def subject(self) -> str:
        return self.commits[0].subject


def normalize_subject(subject: str, cfg: dict) -> str:
    for pattern in cfg.get("normalize") or []:
        subject = re.sub(pattern, "", subject)
    return subject.strip()


def sentence(text: str) -> str:
    text = text.strip().rstrip(".")
    return text[:1].upper() + text[1:] if text else text


def reverted_subject(subject: str) -> Optional[str]:
    m = re.match(r'^Revert "(.+)"\s*$', subject)
    if m:
        return m.group(1)
    m = re.match(r"^revert(?:\([^)]*\))?!?:\s*(.+)$", subject, re.I)
    return m.group(1).strip() if m else None


def is_breaking(commit: Commit, match: Optional[re.Match]) -> bool:
    return bool(match and match.group("bang")) or bool(re.search(r"^BREAKING[ -]CHANGE:", commit.body, re.M))


def ignore_reason(commit: Commit, cfg: dict, paths: Optional[list]) -> Optional[str]:
    if len(commit.parents) > 1:
        return "merge commit"
    message = f"{commit.subject}\n{commit.body}"
    for pattern in cfg.get("ignore") or []:
        if re.search(pattern, message, re.M):
            return f"matches ignore pattern {pattern}"
    if paths and all(p == DIR or p.startswith(DIR + "/") for _, p in paths):
        return "only touches .changelog/"
    m = CONVENTIONAL.match(normalize_subject(commit.subject, cfg))
    if m and m.group("type").lower() in (cfg.get("skip_types") or []) and not is_breaking(commit, m):
        return f"internal ({m.group('type').lower()})"
    return None


def derive(commit: Commit, cfg: dict) -> Draft:
    subject = normalize_subject(commit.subject, cfg)
    reverted = reverted_subject(subject)
    if reverted:
        return Draft("changed", f"Revert: {sentence(reverted)}", False, [commit])
    m = CONVENTIONAL.match(subject)
    if m:
        ctype, scope = m.group("type").lower(), (m.group("scope") or "").lower()
        ftype = "security" if (ctype == "security" or "security" in scope) else TYPE_MAP.get(ctype, "changed")
        return Draft(ftype, sentence(m.group("desc")), is_breaking(commit, m), [commit])
    return Draft("changed", sentence(subject), is_breaking(commit, None), [commit])


# --------------------------------------------------------------------- versions


@dataclass
class Version:
    parts: dict
    pre: Optional[tuple] = None  # (label, number) for pre-releases such as -beta.2


class Template:
    """A version format such as "{major}.{minor}.{patch}[.hotfix-{hotfix}]".

    {name} is a numeric component; a [...] segment is only written when a component inside it is non-zero.
    Every template also accepts a pre-release suffix "-label.N".
    """

    TOKEN = re.compile(r"\[([^\[\]]*)\]|\{([A-Za-z_]\w*)\}|([^\[\]{}]+)")
    INNER = re.compile(r"\{([A-Za-z_]\w*)\}|([^{}]+)")

    def __init__(self, fmt: str):
        self.fmt, self.parts, self.names = fmt, [], []
        pos = 0
        for m in self.TOKEN.finditer(fmt):
            if m.start() != pos:
                break
            pos = m.end()
            if m.group(1) is not None:
                inner, ipos = [], 0
                for n in self.INNER.finditer(m.group(1)):
                    if n.start() != ipos:
                        break
                    ipos = n.end()
                    inner.append(("var", n.group(1)) if n.group(1) else ("lit", n.group(2)))
                if ipos != len(m.group(1)) or not any(k == "var" for k, _ in inner):
                    raise Fail(f"version format {fmt!r}: an optional [...] segment needs a {{component}}")
                self.parts.append(("opt", inner))
                self.names += [v for k, v in inner if k == "var"]
            elif m.group(2):
                self.parts.append(("var", m.group(2)))
                self.names.append(m.group(2))
            else:
                self.parts.append(("lit", m.group(3)))
        if pos != len(fmt) or not self.names:
            raise Fail(f"invalid version format {fmt!r}; example: {{major}}.{{minor}}.{{patch}}")
        if len(set(self.names)) != len(self.names) or any(n.startswith("pre_") for n in self.names):
            raise Fail(f"version format {fmt!r}: each component may appear once (and not start with pre_)")
        self.regex = re.compile("^" + "".join(self._rx(p) for p in self.parts) + PRE_SUFFIX + "$")

    def _rx(self, part) -> str:
        kind, val = part
        if kind == "lit":
            return re.escape(val)
        if kind == "var":
            return f"(?P<{val}>\\d+)"
        return "(?:" + "".join(self._rx(p) for p in val) + ")?"

    def parse(self, text: Optional[str]) -> Optional[Version]:
        m = self.regex.match((text or "").strip())
        if not m:
            return None
        parts = {n: int(m.group(n)) if m.group(n) is not None else 0 for n in self.names}
        pre = (m.group("pre_label"), int(m.group("pre_n"))) if m.group("pre_label") else None
        return Version(parts, pre)

    def render(self, version: Version) -> str:
        def one(part) -> str:
            kind, val = part
            if kind == "lit":
                return val
            if kind == "var":
                return str(version.parts.get(val, 0))
            return "".join(one(p) for p in val) if any(version.parts.get(v, 0) for k, v in val if k == "var") else ""
        text = "".join(one(p) for p in self.parts)
        return text + (f"-{version.pre[0]}.{version.pre[1]}" if version.pre else "")


def default_rules(levels: list) -> dict:
    regular = [n for n in levels if n != "hotfix"] or levels  # hotfixes are only ever chosen explicitly
    return {"breaking": regular[0],
            "added": "minor" if "minor" in regular else regular[min(1, len(regular) - 1)],
            "default": next((n for n in ("patch", "build") if n in regular), regular[min(2, len(regular) - 1)])}


class Scheme:
    """The repo's versioning: canonical format, level order, bump rules, optional never-resetting counter."""

    def __init__(self, versioning: Optional[dict]):
        self.explicit = bool(versioning)
        data = {**PRESETS["semver"], **(versioning or {})}
        self.preset = data.get("preset")
        self.format = data["format"]
        self.template = Template(self.format)
        self.levels = list(self.template.names)  # most significant first, in format order
        self.counter = data.get("counter")
        custom_format = bool(versioning and "format" in versioning)
        base_rules = default_rules(self.levels) if custom_format else dict(PRESETS["semver"]["bump_rules"])
        self.rules = {**base_rules, **((versioning or {}).get("bump_rules") or {})}
        self.zero_major = data.get("zero_major", True)
        for name, level in [("counter", self.counter)] + [(f"bump_rules.{k}", v) for k, v in self.rules.items()]:
            if level is not None and level not in self.levels:
                raise Fail(f"versioning {name} is {level!r}, but the format {self.format!r} only has "
                           f"{', '.join(self.levels)}")

    def as_config(self) -> dict:
        data = {"format": self.format, "bump_rules": self.rules, "zero_major": self.zero_major}
        if self.counter:
            data["counter"] = self.counter
        if self.preset:
            data = {"preset": self.preset, **data}
        return data

    def file_template(self, entry) -> Template:
        fmt = entry.get("format") if isinstance(entry, dict) else None
        if not fmt:
            return self.template
        tpl = Template(fmt)
        if sorted(tpl.names) != sorted(self.levels):
            raise Fail(f"{_entry_path(entry)}: format {fmt!r} must use exactly the components {', '.join(self.levels)}")
        return tpl

    def parse(self, text: Optional[str]) -> Optional[Version]:
        text = (text or "").strip()
        return self.template.parse(text) or (self.template.parse(text[1:]) if text[:1] in "vV" else None)

    def render(self, version: Version) -> str:
        return self.template.render(version)

    def key(self, version: Version) -> tuple:
        main = tuple(version.parts.get(n, 0) for n in self.levels)
        return main + ((1, "", 0) if version.pre is None else (0, version.pre[0], version.pre[1]))

    def bump(self, current: Version, level: str, pre: Optional[str] = None) -> Version:
        if level not in self.levels:
            raise Fail(f"unknown level {level!r}; this repo's versions have {', '.join(self.levels)}")
        if current.pre and pre:
            number = current.pre[1] + 1 if current.pre[0] == pre else 1
            return Version(dict(current.parts), (pre, number))
        if current.pre:
            return Version(dict(current.parts), None)  # graduate the pre-release
        parts = dict(current.parts)
        parts[level] += 1
        for lower in self.levels[self.levels.index(level) + 1:]:
            if lower != self.counter:
                parts[lower] = 0
        if self.counter and level != self.counter:
            parts[self.counter] += 1
        return Version(parts, (pre, 1) if pre else None)

    def describe(self) -> str:
        rules = ", ".join(f"{'anything else' if k == 'default' else k} -> {v}" for k, v in self.rules.items())
        counter = f"; {self.counter} counts every release" if self.counter else ""
        return f"{self.format} (levels {' > '.join(self.levels)}; {rules}{counter})"

    def examples(self, current: Version) -> list:
        base = Version(dict(current.parts), None)
        out = [(level, self.render(self.bump(base, level))) for level in self.levels]
        out.append(("pre-release", self.render(self.bump(base, self.rules.get("default", self.levels[-1]), "beta"))))
        return out

    def suggest(self, current: Optional[Version], items: list) -> dict:
        """items: (type, breaking) pairs from fragments and drafts."""
        if not items:
            return {"version": None, "level": None, "reason": "nothing unreleased"}
        picked = []
        for ftype, breaking in items:
            key = "breaking" if breaking and "breaking" in self.rules else ftype
            picked.append((self.rules.get(key, self.rules.get("default", self.levels[-1])), key))
        level = min((lvl for lvl, _ in picked), key=self.levels.index)
        causes: dict = {}
        for lvl, key in picked:
            if lvl == level:
                causes[key] = causes.get(key, 0) + 1
        reason = ", ".join(f"{n} {'change' if k == 'default' else k}" for k, n in causes.items())
        if current and self.zero_major and level == self.levels[0] and len(self.levels) > 1 \
                and current.parts.get(self.levels[0], 0) == 0:
            level = self.levels[1]
            reason += f" (while {self.levels[0]} is 0, it bumps {level} instead)"
        version = self.render(self.bump(current, level)) if current else None
        return {"version": version, "level": level, "reason": reason}


def loose_key(version: str) -> tuple:
    pieces = re.split(r"-(?=[A-Za-z])", version, maxsplit=1)
    main, pre = pieces[0].split("+")[0], (pieces[1] if len(pieces) > 1 else None)
    return (tuple(int(x) for x in re.findall(r"\d+", main)), 0 if pre else 1,
            tuple(int(x) for x in re.findall(r"\d+", pre or "")))


def ecosystem(path: str) -> Optional[str]:
    p = Path(path)
    if p.name in ("package.json", "Cargo.toml", "tauri.conf.json") or \
            (p.name == "plugin.json" and p.parent.name == ".claude-plugin"):
        return "semver"
    if p.name in ("pyproject.toml", "setup.py") or p.suffix == ".py":
        return "pep440"
    return None


def fits_ecosystem(kind: Optional[str], version: str) -> bool:
    if kind == "semver":
        return bool(SEMVER_STRICT.match(version))
    if kind == "pep440":
        return bool(PEP440.match(version))
    return True


def suggest_file_format(kind: str, scheme: Scheme) -> str:
    """A per-file format that stores the same components in a form the ecosystem accepts."""
    levels = scheme.levels
    core, extras = [f"{{{n}}}" for n in levels[:3]], levels[3:]
    if kind == "semver":
        text = ".".join(core + ["0"] * (3 - len(core)))
        return text + ("[+" + ".".join(f"{e}.{{{e}}}" for e in extras) + "]" if extras else "")
    text = ".".join(core)
    if len(extras) == 1:
        return text + f"[.post{{{extras[0]}}}]"
    return text + "".join(f".{{{e}}}" for e in extras)


def _entry_path(entry) -> str:
    return entry["path"] if isinstance(entry, dict) else str(entry)


def _version_kind(entry) -> str:
    if isinstance(entry, dict) and entry.get("pattern"):
        return "pattern"
    name = Path(_entry_path(entry)).name
    if name.endswith(".json"):
        return "json"
    if name.endswith(".toml"):
        return "toml"
    if name.endswith(".py"):
        return "python"
    return "text"


def _json_top_level_spans(text: str, version: str) -> list:
    pattern = re.compile(r'"version"\s*:\s*"' + re.escape(version) + '"')
    targets = {m.start(): m for m in pattern.finditer(text)}
    spans, depth, in_str, escape = [], 0, False, False
    for i, ch in enumerate(text):
        if i in targets and not in_str and depth == 1:
            m = targets[i]
            spans.append((m.end() - len(version) - 1, m.end() - 1))
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
    return spans


def _toml_spans(text: str) -> list:
    spans, section, offset = [], None, 0
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        header = re.match(r"^\[\s*([^\[\]]+?)\s*\]\s*(#.*)?$", stripped)
        if stripped.startswith("[["):
            section = None
        elif header:
            section = header.group(1).replace(" ", "")
        elif section in TOML_VERSION_SECTIONS:
            m = re.match(r"^(\s*version\s*=\s*)([\"'])([^\"']*)\2", line)
            if m:
                spans.append((offset + m.start(3), offset + m.end(3)))
        offset += len(line)
    return spans


def _version_spans(entry, text: str) -> tuple:
    """Return (spans, note). Each span is the (start, end) of the version string inside text."""
    kind, name = _version_kind(entry), Path(_entry_path(entry)).name
    if kind == "json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            return [], f"invalid JSON ({exc.msg})"
        value = data.get("version") if isinstance(data, dict) else None
        if not isinstance(value, str) or not VERSION_VALUE.match(value):
            return [], "no top-level version" if value is None else f"version is {value!r}, not a version number"
        return _json_top_level_spans(text, value), ""
    if kind == "toml":
        spans = _toml_spans(text)
        if not spans and re.search(r"^\s*dynamic\s*=.*version", text, re.M):
            return [], "version is dynamic"
        if not spans and re.search(r"^\s*version\.workspace\s*=\s*true", text, re.M):
            return [], "inherits the workspace version"
        return spans, "" if spans else "no version in [project], [package], [workspace.package] or [tool.poetry]"
    if kind == "python":
        pattern = r"^(__version__\s*=\s*)([\"'])([^\"']+)\2"
        spans = [(m.start(3), m.end(3)) for m in re.finditer(pattern, text, re.M)]
        if not spans and name == "setup.py":
            spans = [(m.start(3), m.end(3)) for m in re.finditer(r"(\bversion\s*=\s*)([\"'])([^\"']+)\2", text)]
        return spans, "" if spans else "no literal version string"
    if kind == "pattern":
        try:
            regex = re.compile(entry["pattern"], re.M)
        except re.error as exc:
            return [], f"invalid pattern: {exc}"
        if regex.groups != 1:
            return [], "pattern must have exactly one capture group"
        return [(m.start(1), m.end(1)) for m in regex.finditer(text)], ""
    stripped = text.strip()
    start = text.find(stripped)
    return ([(start, start + len(stripped))] if stripped else []), "" if stripped else "empty file"


def read_version_file(root: Path, entry) -> tuple:
    """Return (version or None, note)."""
    path = root / _entry_path(entry)
    if not path.is_file():
        return None, "file not found"
    text = path.read_text(encoding="utf-8")
    spans, note = _version_spans(entry, text)
    if len(spans) != 1:
        return None, note or (f"found {len(spans)} version strings, expected exactly 1" if spans else "no version found")
    value = text[spans[0][0]:spans[0][1]]
    if not VERSION_VALUE.match(value):
        return None, f"{value!r} is not a version number"
    return value, ""


def write_version_file(root: Path, entry, new: str) -> None:
    path = root / _entry_path(entry)
    text = path.read_text(encoding="utf-8")
    spans, note = _version_spans(entry, text)
    if len(spans) != 1:
        raise Fail(f"{_entry_path(entry)}: cannot locate a unique version ({note or len(spans)})")
    start, end = spans[0]
    path.write_text(text[:start] + new + text[end:], encoding="utf-8")


def version_states(repo: Repo, cfg: dict, scheme: Scheme) -> list:
    states = []
    for entry in cfg.get("version_files") or []:
        raw, note = read_version_file(repo.root, entry)
        template = scheme.file_template(entry)
        parsed = template.parse(raw) if raw else None
        if raw and parsed is None:
            note = f"{raw!r} does not match the format {template.fmt!r}"
        states.append({"path": _entry_path(entry), "entry": entry, "raw": raw, "version": parsed, "note": note,
                       "template": template})
    return states


def latest_tag(repo: Repo, cfg: dict, warnings: list) -> Optional[tuple]:
    fmt = cfg.get("tag_format") or "v{version}"
    regex = re.compile("^" + re.escape(fmt).replace(re.escape("{version}"), f"({VERSION_TEXT})") + "$")
    best = None
    for tag in repo.git("tag", "--merged", "HEAD", check=False).splitlines():
        m = regex.match(tag)
        if m:
            if best is None or loose_key(m.group(1)) > loose_key(best[1]):
                best = (tag, m.group(1))
        elif re.search(r"\d+\.\d+", tag):
            warnings.append(f"tag {tag!r} looks like a version but does not match tag_format {fmt!r}; ignored")
    return best


def load_history(repo: Repo) -> dict:
    if not repo.json_path.is_file():
        return {"versions": []}
    return json.loads(repo.json_path.read_text(encoding="utf-8"))


def current_version(repo: Repo, cfg: dict, scheme: Scheme, warnings: list) -> tuple:
    """Return (Version or None, display string or None, source)."""
    states = version_states(repo, cfg, scheme)
    for s in states:
        if s["version"] is None:
            warnings.append(f"version file {s['path']}: {s['note']}")
    parsed = [s for s in states if s["version"]]
    if parsed:
        if len({scheme.key(s["version"]) for s in parsed}) > 1:
            warnings.append("version files disagree: " + ", ".join(f"{s['path']}={s['raw']}" for s in parsed))
        return parsed[0]["version"], scheme.render(parsed[0]["version"]), parsed[0]["path"]
    unparsed = next((s for s in states if s["raw"]), None)
    if unparsed:
        return None, unparsed["raw"], f"{unparsed['path']} (does not fit the version format {scheme.format!r})"
    history = load_history(repo).get("versions") or []
    if history:
        return scheme.parse(history[0]["version"]), history[0]["version"], f"{DIR}/changelog.json"
    tag = latest_tag(repo, cfg, [])
    if tag:
        return scheme.parse(tag[1]), tag[1], f"tag {tag[0]}"
    return None, None, "no version files, releases or version tags"


def find_baseline(repo: Repo, cfg: dict, warnings: list) -> tuple:
    history = load_history(repo).get("versions") or []
    if history:
        version = history[0]["version"]
        sha = repo.git("log", "-1", "--format=%H", "-S", f'"version": "{version}"', "--",
                       f"{DIR}/changelog.json", check=False)
        if sha:
            return sha, f"release {version} (commit {sha[:7]})"
    tag = latest_tag(repo, cfg, warnings)
    if tag:
        return tag[0], f"tag {tag[0]}"
    base = cfg.get("baseline")
    if base:
        if repo.ok("rev-parse", "--verify", "-q", f"{base}^{{commit}}"):
            return base, f"init baseline {base[:7]}"
        warnings.append(f"init baseline {base} no longer exists (history rewritten?); using the whole history")
    return None, "start of history"


# ---------------------------------------------------------------------- analysis


@dataclass
class Analysis:
    baseline: Optional[str]
    baseline_label: str
    revs: list
    commits: list
    fragments: list
    drafts: list
    ignored: list
    draft_only: list
    added_by: dict
    warnings: list


def analyze(repo: Repo, cfg: dict, revs: Optional[list] = None) -> Analysis:
    warnings: list = []
    fragments = load_fragments(repo)
    baseline, label = find_baseline(repo, cfg, warnings)
    if revs is None:
        revs = [f"{baseline}..HEAD"] if baseline else ["HEAD"]
    commits = list_commits(repo, revs) if repo.has_head() else []
    paths = changed_paths(repo, revs) if commits else {}
    skipped = load_skipped(repo)
    # The last release's backup still covers its commits while the release commit is pending.
    released_refs = set()
    if repo.released.is_dir():
        for p in repo.released.glob("*/*.md"):
            released_refs.update(parse_fragment(p).commits)
        for p in repo.released.glob("*/skipped.txt"):
            skipped += [(line.partition("\t")[0].strip().lower(), line.partition("\t")[2].strip())
                        for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
    skip_subjects = {s for _, s in skipped if s}
    by_rel = {repo.rel(f.path): f for f in fragments}

    # Subjects of fragment commits that are not in the range (rebased or squashed history).
    outside = [ref for f in fragments for ref in f.commits if not any(c.matches(ref) for c in commits)]
    fragment_subjects = resolve_subjects(repo, outside)

    added_by = {}
    for c in commits:
        for status, p in paths.get(c.sha, []):
            if status.startswith("A") and p.startswith(UNRELEASED + "/") and p.endswith(".md"):
                added_by.setdefault(p, c.short)

    reverts = {c.sha: reverted_subject(c.subject) for c in commits}
    reverted = {s for s in reverts.values() if s}
    subjects_in_range = {c.subject for c in commits}

    reach_cache: dict = {}

    def reachable(ref: str) -> bool:
        if ref not in reach_cache:
            reach_cache[ref] = repo.ok("merge-base", "--is-ancestor", ref, "HEAD")
        return reach_cache[ref]

    def coverage(c: Commit):
        owners = [f for f in fragments if any(c.matches(ref) for ref in f.commits)]
        for status, p in paths.get(c.sha, []):
            if status.startswith("A") and p.startswith(UNRELEASED + "/") and p.endswith(".md"):
                f = by_rel.get(p)
                if f is None:
                    return "covered", None  # added, then released or removed: already handled
                if not f.commits:
                    owners.append(f)  # written before committing, so it names no commit
                elif not any(reachable(ref) for ref in f.commits):
                    owners.append(f)  # names commits that were squashed or rebased away: it came with this one
        if owners:
            return ("draft", owners[0]) if all(f.draft for f in owners) else ("covered", None)
        if any(c.matches(sha) for sha, _ in skipped) or c.subject in skip_subjects:
            return "covered", None
        if c.subject in fragment_subjects.values():
            return "covered", None
        if any(c.matches(ref) for ref in released_refs):
            return "covered", None
        return None, None

    drafts, keyed, ignored, draft_only = [], {}, [], []
    for c in commits:
        reason = ignore_reason(c, cfg, paths.get(c.sha))
        if not reason and c.subject in reverted:
            reason = "reverted later in this range"
        if not reason and reverts.get(c.sha) in subjects_in_range:
            reason = "reverts a commit in this range"
        if reason:
            ignored.append((c, reason))
            continue
        state, owner = coverage(c)
        if state == "covered":
            continue
        if state == "draft":
            draft_only.append((c, owner))
            continue
        d = derive(c, cfg)
        key = normalize_subject(c.subject, cfg).lower()
        if key in keyed:
            keyed[key].commits.append(c)
        else:
            keyed[key] = d
            drafts.append(d)

    for f in fragments:
        rel = repo.rel(f.path)
        if f.problems:
            warnings.append(f"{rel}: " + "; ".join(f.problems))
        for ref in f.commits:
            subject = fragment_subjects.get(ref) or next((c.subject for c in commits if c.matches(ref)), None)
            if subject and subject in reverted:
                warnings.append(f"{rel} describes {ref} ({subject!r}), which was reverted; drop or rewrite it")
    return Analysis(baseline, label, revs, commits, fragments, drafts, ignored, draft_only, added_by, warnings)


# ---------------------------------------------------------------------- commands


def unreleased_items(an: Analysis) -> list:
    return [(f.type, f.breaking) for f in an.fragments if not f.problems] + [(d.type, d.breaking) for d in an.drafts]


def _print(*lines: str) -> None:
    print("\n".join(lines))


def _clip(text: str, width: int = 72) -> str:
    text = " ".join(text.split())
    return text if len(text) <= width else text[: width - 1] + "…"


def cmd_status(args) -> int:
    repo = Repo(args.repo)
    if not repo.initialized:
        if args.json:
            print(json.dumps({"initialized": False, "root": str(repo.root)}, indent=2))
        else:
            _print(f"{repo.root}: changelogger is not set up here (no {DIR}/config.json).",
                   "Next: `changelogger init --dry-run` to see what setup would create.")
        return 0
    cfg = repo.config()
    scheme = Scheme(cfg.get("versioning"))
    an = analyze(repo, cfg)
    current, version, source = current_version(repo, cfg, scheme, an.warnings)
    states = version_states(repo, cfg, scheme)
    suggestion = scheme.suggest(current, unreleased_items(an))
    upcoming = dict(scheme.examples(current)) if current else {}
    if args.json:
        print(json.dumps({
            "initialized": True, "root": str(repo.root), "version": version, "version_source": source,
            "versioning": scheme.as_config(), "versioning_chosen": scheme.explicit, "next_versions": upcoming,
            "version_files": [{"path": s["path"], "version": s["raw"], "note": s["note"]} for s in states],
            "baseline": an.baseline, "baseline_label": an.baseline_label, "commits_since": len(an.commits),
            "fragments": [{
                "path": repo.rel(f.path), "type": f.type, "breaking": f.breaking, "audience": f.audience,
                "commits": f.commits, "added_by": an.added_by.get(repo.rel(f.path)), "draft": f.draft,
                "highlight": f.highlight,
                "text": f.text, "problems": f.problems} for f in an.fragments],
            "drafts": [{"type": d.type, "text": d.text, "breaking": d.breaking,
                        "commits": [{"sha": c.short, "subject": c.subject} for c in d.commits]} for d in an.drafts],
            "draft_only": [{"sha": c.short, "subject": c.subject, "fragment": repo.rel(f.path)} for c, f in an.draft_only],
            "ignored": [{"sha": c.short, "subject": c.subject, "reason": r} for c, r in an.ignored],
            "suggestion": suggestion, "warnings": an.warnings,
        }, indent=2))
        return 0

    out = [f"Repo: {repo.root}"]
    if version:
        extra = f" (+{len(states) - 1} more file(s))" if len(states) > 1 else ""
        out.append(f"Version: {version} from {source}{extra}")
    else:
        out.append(f"Version: none ({source}); `init --version-file` or a VERSION file fixes this")
    chosen = "" if scheme.explicit else " [default, never chosen: ask the user how they version, then set it]"
    out.append(f"Versioning: {scheme.describe()}{chosen}")
    if upcoming:
        out.append("Next versions: " + " | ".join(f"{k} {v}" for k, v in upcoming.items()))
    out.append(f"Baseline: {an.baseline_label}; {len(an.commits)} commit(s) since")
    out.append("")
    out.append(f"Unreleased fragments ({len(an.fragments)}):" if an.fragments else "Unreleased fragments: none")
    for f in an.fragments:
        flags = " ".join(x for x in ("BREAKING" if f.breaking else "", "HIGHLIGHT" if f.highlight else "",
                                     "internal" if f.audience == "internal" else "",
                                     "DRAFT" if f.draft else "", "INVALID" if f.problems else "") if x)
        out.append(f"  {f.type or '?':<10} {flags:<17} {f.path.name}")
        out.append(f"  {'':<10} {'':<17} {_clip(f.text)}")
    if an.drafts:
        out.append("")
        out.append(f"Commits without a fragment -> derived drafts ({len(an.drafts)}):")
        for d in an.drafts:
            shas = ",".join(c.short for c in d.commits)
            out.append(f"  {shas}  {_clip(d.subject, 60)}")
            out.append(f"      draft: {d.type}{' BREAKING' if d.breaking else ''}: {_clip(d.text, 64)}")
    if an.draft_only:
        out.append("")
        out.append("Commits covered only by draft fragments (polish them):")
        for c, f in an.draft_only:
            out.append(f"  {c.short}  {_clip(c.subject, 50)} -> {f.path.name}")
    if an.ignored:
        counts: dict = {}
        for _, reason in an.ignored:
            key = reason.split(" pattern")[0] if reason.startswith("matches") else reason
            counts[key] = counts.get(key, 0) + 1
        out.append("")
        out.append(f"Ignored commits ({len(an.ignored)}): " + ", ".join(f"{n} {k}" for k, n in counts.items()))
    out.append("")
    if suggestion["version"]:
        out.append(f"Suggested next version: {suggestion['version']} ({suggestion['level']}: {suggestion['reason']})")
    else:
        out.append(f"Suggested next version: n/a ({suggestion['reason']})")
    for w in an.warnings:
        out.append(f"Warning: {w}")
    if an.drafts or an.draft_only or any(f.draft for f in an.fragments):
        out.append("")
        out.append("Next: write fragments for the drafts (`new --commits <sha> ...`), `skip <sha>` commits users "
                   "won't notice, then remove `draft: true` from polished fragments.")
    _print(*out)
    return 0


def cmd_new(args) -> int:
    repo = Repo(args.repo)
    repo.config()
    text = sys.stdin.read() if args.text == "-" else args.text
    commits = [short_sha(repo, ref) for ref in re.split(r"[,\s]+", args.commits or "") if ref]
    path = write_fragment(repo, args.type, text, commits, args.breaking, args.audience, draft=False, slug=args.slug,
                          highlight=args.highlight)
    print(repo.rel(path))
    return 0


def cmd_skip(args) -> int:
    repo = Repo(args.repo)
    repo.config()
    existing = {sha for sha, _ in load_skipped(repo)}
    repo.unreleased.mkdir(parents=True, exist_ok=True)
    added = []
    with repo.skipped_path.open("a", encoding="utf-8") as fh:
        for ref in args.commits:
            sha = short_sha(repo, ref)
            if sha in existing:
                continue
            subject = repo.git("log", "-1", "--format=%s", sha, check=False)
            fh.write(f"{sha}\t{subject}\n")
            existing.add(sha)
            added.append(sha)
    print(f"skipped: {', '.join(added) if added else 'nothing new'} ({repo.rel(repo.skipped_path)})")
    return 0


def cmd_materialize(args) -> int:
    repo = Repo(args.repo)
    cfg = repo.config()
    an = analyze(repo, cfg, revs=[args.range] if args.range else None)
    written = []
    for d in an.drafts:
        when = dt.datetime.fromtimestamp(d.commits[0].time, dt.timezone.utc)
        path = write_fragment(repo, d.type, d.text, [c.short for c in d.commits], d.breaking, draft=True, when=when)
        written.append(repo.rel(path))
    print("\n".join(written) if written else "no uncovered commits; nothing written")
    return 0


def cmd_post_commit(args) -> int:
    """Called by the opt-in git hook. Must stay quiet and never fail the commit."""
    try:
        repo = Repo(args.repo)
        if not repo.initialized:
            return 0
        an = analyze(repo, repo.config(), revs=["-1", "HEAD"])
        for d in an.drafts:
            when = dt.datetime.fromtimestamp(d.commits[0].time, dt.timezone.utc)
            write_fragment(repo, d.type, d.text, [c.short for c in d.commits], d.breaking, draft=True, when=when)
    except Exception:  # noqa: BLE001 - a changelog problem must never break a commit
        return 0
    return 0


# ----------------------------------------------------------------------- init


def detect_changelog(repo: Repo, override: Optional[str]) -> dict:
    names = [override] if override else ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "changelog.md"]
    for name in names:
        path = repo.root / name
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            info = {"path": name, "exists": True, "heading_format": DEFAULT_CONFIG["heading_format"],
                    "group_by_type": True, "unreleased_sections": len(_unreleased_headings(text))}
            for line in text.splitlines():
                m = re.match(r"^##\s+.*?(" + VERSION_TEXT + ")", line)
                if m and not re.match(r"^##\s+\[?unreleased", line, re.I):
                    fmt = line.replace(m.group(1), "{version}", 1)
                    info["heading_format"] = re.sub(r"\d{4}-\d{2}-\d{2}", "{date}", fmt, count=1)
                    break
            info["group_by_type"] = bool(re.search(
                r"^###\s+(Added|Changed|Deprecated|Removed|Fixed|Security)\b", text, re.M | re.I))
            return info
    return {"path": override or "CHANGELOG.md", "exists": False, "heading_format": DEFAULT_CONFIG["heading_format"],
            "group_by_type": True, "unreleased_sections": 0}


def _unreleased_headings(text: str) -> list:
    return [i for i, line in enumerate(text.splitlines()) if re.match(r"^##\s+\[?unreleased\b", line, re.I)]


def detect_version_files(repo: Repo) -> list:
    """Return [(path, version|None, note)] for plausible version files, best candidate first."""
    priority = {n: i for i, n in enumerate(("VERSION", "pyproject.toml", "package.json", "Cargo.toml", "setup.py",
                                            "plugin.json", "tauri.conf.json", "version.txt", "__init__.py"))}
    found = []
    for rel in repo.tracked():
        p = Path(rel)
        if p.name not in VERSION_FILE_NAMES or "node_modules" in p.parts or len(p.parts) > 5:
            continue
        if p.name == "plugin.json" and p.parent.name != ".claude-plugin":
            continue
        if p.name == "__init__.py":
            try:
                if "__version__" not in (repo.root / p).read_text(encoding="utf-8"):
                    continue
            except (OSError, UnicodeDecodeError):
                continue
        version, note = read_version_file(repo.root, rel)
        if version is None and p.name in ("Cargo.toml", "package.json") and len(p.parts) > 1:
            continue  # workspace members without their own version are noise
        found.append((rel, version, note))
    found.sort(key=lambda item: (len(Path(item[0]).parts), priority.get(Path(item[0]).name, 99), item[0]))
    return found


AUTOMATION_FILES = {
    ".releaserc": "semantic-release", ".releaserc.json": "semantic-release", ".releaserc.yml": "semantic-release",
    ".releaserc.yaml": "semantic-release", ".releaserc.js": "semantic-release", "release.config.js": "semantic-release",
    "release.config.cjs": "semantic-release", "release.config.mjs": "semantic-release",
    "release-please-config.json": "release-please", ".release-please-manifest.json": "release-please",
    ".changeset/config.json": "changesets", ".bumpversion.cfg": "bump2version", ".bumpversion.toml": "bump-my-version",
    ".cz.toml": "commitizen", ".cz.json": "commitizen", "cz.json": "commitizen", ".versionrc": "standard-version",
    ".versionrc.json": "standard-version", "towncrier.toml": "towncrier", "GitVersion.yml": "GitVersion",
    "release.toml": "cargo-release", "lerna.json": "lerna", ".release-it.json": "release-it",
}
AUTOMATION_SECTIONS = {"tool.bumpversion": "bump-my-version", "tool.commitizen": "commitizen",
                       "tool.towncrier": "towncrier", "tool.semantic_release": "python-semantic-release"}
AUTOMATION_NPM = ("semantic-release", "release-it", "standard-version", "@changesets/cli", "release-please")
WORKFLOW_SIGNS = [
    (r"semantic-release", "runs semantic-release"),
    (r"release-please", "runs release-please"),
    (r"changesets/action", "runs changesets"),
    (r"\b(npm|yarn|pnpm) version\b|bump2version|bump-my-version|\bcz bump\b|cargo release", "bumps the version"),
    (r"(?m)^\s*tags:", "triggers on tag pushes"),
    (r"npm publish|twine upload|pypa/gh-action-pypi-publish|cargo publish|uv publish|poetry publish",
     "publishes packages"),
    (r"gh release create|softprops/action-gh-release|actions/create-release", "creates GitHub Releases"),
]


def detect_automation(repo: Repo, tracked: list) -> list:
    """Existing release tooling: two tools bumping the same version would fight, so setup must ask about it."""
    found = []
    for rel in tracked:
        name = rel if rel.startswith(".changeset/") else Path(rel).name
        if name in AUTOMATION_FILES and len(Path(rel).parts) <= 2:
            found.append(f"{rel}: {AUTOMATION_FILES[name]}")
    for rel in ("pyproject.toml", "setup.cfg"):
        text = (repo.root / rel).read_text(encoding="utf-8") if (repo.root / rel).is_file() else ""
        for section, tool in AUTOMATION_SECTIONS.items():
            if re.search(r"(?m)^\[" + re.escape(section) + r"\]", text):
                found.append(f"{rel} [{section}]: {tool}")
    pkg = repo.root / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        deps = {**(data.get("devDependencies") or {}), **(data.get("dependencies") or {})}
        found += [f"package.json: {name}" for name in AUTOMATION_NPM if name in deps]
        if "release" in data:
            found.append("package.json \"release\" config: semantic-release")
    for rel in tracked:
        if rel.startswith(".github/workflows/") and rel.endswith((".yml", ".yaml")):
            text = (repo.root / rel).read_text(encoding="utf-8", errors="replace")
            signs = [label for pattern, label in WORKFLOW_SIGNS if re.search(pattern, text)]
            if signs:
                found.append(f"{rel}: {', '.join(dict.fromkeys(signs))}")
    return found


def cmd_init(args) -> int:
    repo = Repo(args.repo)
    if repo.initialized and not args.force:
        print(f"{DIR}/config.json already exists; run `changelogger status` (or `init --force` to regenerate).")
        return 0
    warnings: list = []
    candidates = detect_version_files(repo)
    if args.version_file:
        chosen = []
        for rel in args.version_file:
            version, note = read_version_file(repo.root, rel)
            if version is None:
                raise Fail(f"{rel}: {note}")
            chosen.append((rel, version))
        left_out = [(p, v, n) for p, v, n in candidates if p not in args.version_file]
    else:
        main = next((v for _, v, _ in candidates if v), None)
        chosen = [(p, v) for p, v, _ in candidates if v and v == main]
        left_out = [(p, v, n) for p, v, n in candidates if not (v and v == main)]
    scheme = Scheme(build_versioning(args))
    file_formats = {}
    for item in args.file_format or []:
        path, sep, fmt = item.partition("=")
        if not sep or not fmt:
            raise Fail(f"--file-format expects PATH=FORMAT, got {item!r}")
        file_formats[path.strip()] = fmt.strip()
    entries = [{"path": p, "format": file_formats[p]} if p in file_formats else p for p, _ in chosen]
    states = []
    for entry, (path, raw) in zip(entries, chosen):
        template = scheme.file_template(entry)
        states.append((path, raw, template.parse(raw), template))
    parsed = [v for _, _, v, _ in states if v]
    if len({scheme.key(v) for v in parsed}) > 1:
        raise Fail("the chosen version files disagree: " + ", ".join(f"{p}={raw}" for p, raw, _, _ in states))
    current = parsed[0] if parsed else None
    compat = []
    for path, raw, version, _ in states:
        kind = ecosystem(path)
        if version is None and kind and path not in file_formats:
            suggestion = suggest_file_format(kind, scheme)
            reread = Template(suggestion).parse(raw)
            if reread:
                compat.append(f"{path} stores {raw}, which {scheme.format!r} cannot read; with "
                              f"--file-format '{path}={suggestion}' it reads as {scheme.render(reread)}")
    if current:
        samples = [current] + [scheme.bump(current, level) for level in scheme.levels]
        for path, _, _, template in states:
            kind = ecosystem(path)
            bad = sorted({template.render(v) for v in samples if not fits_ecosystem(kind, template.render(v))})
            if kind and bad:
                compat.append(f"{path}: {ECOSYSTEMS[kind]}, but this scheme would write {', '.join(bad[:3])}. "
                              f"Give it its own format: --file-format '{path}={suggest_file_format(kind, scheme)}'")

    changelog = detect_changelog(repo, args.changelog)
    tracked = repo.tracked()
    lockfiles = [(p, LOCKFILES[Path(p).name]) for p in tracked
                 if Path(p).name in LOCKFILES and len(Path(p).parts) <= 3]
    automation = detect_automation(repo, tracked)

    tag = latest_tag(repo, {**DEFAULT_CONFIG, "tag_format": args.tag_format}, warnings)
    choice = args.baseline
    if choice == "auto":
        baseline = tag[0] if tag else (repo.git("rev-parse", "HEAD") if repo.has_head() else None)
    elif choice == "root":
        baseline = None
    elif choice == "head":
        baseline = repo.git("rev-parse", "HEAD") if repo.has_head() else None
    else:
        baseline = repo.git("rev-parse", "--verify", f"{choice}^{{commit}}")
    since = int(repo.git("rev-list", "--count", f"{baseline}..HEAD" if baseline else "HEAD", check=False) or 0) \
        if repo.has_head() else 0

    config = {
        "changelog": changelog["path"],
        "heading_format": args.heading_format or changelog["heading_format"],
        "group_by_type": changelog["group_by_type"],
        "tag_format": args.tag_format,
        "versioning": scheme.as_config(),
        "version_files": entries,
        "whats_new_path": args.whats_new,
        "skip_types": DEFAULT_CONFIG["skip_types"],
        "ignore": DEFAULT_CONFIG["ignore"] + (args.ignore or []),
        "normalize": args.normalize or [],
        "baseline": baseline,
    }

    out = [f"changelogger init{' (dry run)' if args.dry_run else ''} in {repo.root}", ""]
    out.append(f"Versioning: {scheme.describe()}")
    if current:
        out.append(f"  current {scheme.render(current)} -> next: " +
                   " | ".join(f"{k} {v}" for k, v in scheme.examples(current)))
        out.append(f"  tags look like {args.tag_format.replace('{version}', scheme.render(current))}; changelog "
                   f"headings like {config['heading_format'].replace('{version}', scheme.render(current)).replace('{date}', dt.date.today().isoformat())}")
    elif chosen and not compat:
        out.append(f"  current version {chosen[0][1]} does not fit {scheme.format!r}: the first release under this "
                   "scheme needs an explicit version (`bump <version in the new format>`)")
    out += [f"  Compatibility: {c}" for c in compat]
    if chosen:
        out.append(f"Version files, bumped together (all at {chosen[0][1]}):")
        out += [f"  {p}" + (f"  (format {file_formats[p]!r})" if p in file_formats else "") for p, _ in chosen]
    else:
        out.append("Version files: none found. Propose a VERSION file (echo 0.1.0 > VERSION) or pass --version-file.")
    if left_out:
        out.append("Left out (different version or unreadable; add with --version-file if they belong):")
        out += [f"  {p}  {v or ''}{'  ' + n if n else ''}".rstrip() for p, v, n in left_out]
    if changelog["exists"]:
        out.append(f"Changelog: {changelog['path']} (existing; headings like {changelog['heading_format']!r}, "
                   f"{'grouped by type' if changelog['group_by_type'] else 'plain bullets'})")
        if changelog["unreleased_sections"]:
            out.append(f"  {changelog['unreleased_sections']} 'Unreleased' section(s) found: run `adopt` after init "
                       "to turn them into fragments.")
    else:
        out.append(f"Changelog: {changelog['path']} (created at the first release, Keep a Changelog format)")
    if lockfiles:
        out.append("Lockfiles to refresh after a bump:")
        out += [f"  {p}: {cmd}" for p, cmd in lockfiles]
    if automation:
        out.append("Release automation already in the repo (ask whether changelogger replaces it or leaves "
                   "versioning to it):")
        out += [f"  {a}" for a in automation]
    else:
        out.append("Release automation: none found (releases are manual unless the user wants CI to release on merge)")
    base_label = f"tag {tag[0]}" if (tag and baseline == tag[0]) else (baseline[:7] if baseline else "start of history")
    out.append(f"Baseline: {base_label}; {since} commit(s) since (backfill with `materialize`)")
    out.append(f"What's new JSON: {args.whats_new or 'not configured (set whats_new_path in config when you add one)'}")
    out += [f"Warning: {w}" for w in warnings]
    out.append("")
    if args.dry_run:
        out.append(f"Would create {DIR}/config.json, {UNRELEASED}/, {DIR}/README.md. Nothing written.")
        _print(*out)
        return 0

    repo.unreleased.mkdir(parents=True, exist_ok=True)
    (repo.unreleased / ".gitkeep").touch()
    repo.config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    readme = repo.dir / "README.md"
    if not readme.exists():
        readme.write_text(DIR_README, encoding="utf-8")
    out.append(f"Created {DIR}/config.json, {UNRELEASED}/, {DIR}/README.md.")
    _print(*out)
    return 0


def build_versioning(args) -> dict:
    if args.version_format and args.scheme:
        raise Fail("use either --scheme (a preset) or --version-format (a custom format), not both")
    if args.version_format:
        data = {"format": args.version_format}
    else:
        data = {"preset": args.scheme or "semver", **json.loads(json.dumps(PRESETS[args.scheme or "semver"]))}
    if args.counter:
        data["counter"] = args.counter
    rules = dict(data.get("bump_rules") or {})
    for item in args.bump_rule or []:
        key, sep, level = item.partition("=")
        if not sep:
            raise Fail(f"--bump-rule expects KEY=LEVEL (e.g. breaking=major, added=minor, default=patch), got {item!r}")
        rules[key.strip()] = level.strip()
    if rules:
        data["bump_rules"] = rules
    return Scheme(data).as_config()


DIR_README = """# .changelog

Changelog entries that have not been released yet. Maintained with the changelogger skill.

- `unreleased/` holds one Markdown fragment per user-visible change, written when the change is made.
  `skipped.txt` lists commits deliberately left out of the changelog.
- `released/<version>/` keeps the fragments of the most recent release as a backup.
- `changelog.json` is the structured release history (the source for "What's new" views and release notes).
- `config.json` holds settings: version files bumped together, changelog style, tag format, ignore rules.

A fragment looks like this (file name: anything ending in `.md`):

```
---
type: fixed          # added | changed | deprecated | removed | fixed | security
breaking: false
audience: user       # user | internal (internal entries stay out of What's new)
commits: 3f2a9c1
---
Exported CSV files no longer drop the last row.
```

Write it for the people who use the software, not for the people reading the diff.
"""


# ---------------------------------------------------------------------- adopt


def cmd_adopt(args) -> int:
    repo = Repo(args.repo)
    cfg = repo.config()
    path = repo.root / cfg["changelog"]
    if not path.is_file():
        print(f"{cfg['changelog']} does not exist; nothing to adopt")
        return 0
    lines = path.read_text(encoding="utf-8").splitlines()
    h2 = [i for i, line in enumerate(lines) if line.startswith("## ")] + [len(lines)]
    sections = [(h2[k], h2[k + 1]) for k in range(len(h2) - 1) if re.match(r"^##\s+\[?unreleased\b", lines[h2[k]], re.I)]
    if not sections:
        print("no 'Unreleased' sections found; nothing to adopt")
        return 0
    reverse_titles = {v.lower(): k for k, v in TITLES.items()}
    items = []
    for start, end in sections:
        date_m = re.search(r"\d{4}-\d{2}-\d{2}", lines[start])
        when = dt.datetime.strptime(date_m.group(0), "%Y-%m-%d").replace(tzinfo=dt.timezone.utc) if date_m else None
        current_type, buf = None, None

        def flush():
            nonlocal buf
            if buf and " ".join(buf).strip():
                items.append((current_type, " ".join(buf).strip(), when))
            buf = None

        for line in lines[start + 1:end]:
            h3 = re.match(r"^###\s+(.+?)\s*$", line)
            bullet = re.match(r"^\s{0,1}[-*]\s+(.*)$", line)
            if h3:
                flush()
                current_type = reverse_titles.get(h3.group(1).lower())
            elif bullet:
                flush()
                buf = [bullet.group(1).strip()]
            elif not line.strip():
                flush()
            elif buf is not None:
                buf.append(line.strip())
            else:
                buf = [line.strip()]
        flush()
    created = []
    for ftype, text, when in items:
        if args.dry_run:
            created.append(f"(dry run) {ftype or 'changed'}{' [draft]' if not ftype else ''}: {_clip(text)}")
            continue
        p = write_fragment(repo, ftype or "changed", text, [], draft=ftype is None, when=when)
        created.append(repo.rel(p))
    if not args.dry_run:
        keep = [line for i, line in enumerate(lines) if not any(s <= i < e for s, e in sections)]
        path.write_text("\n".join(keep).rstrip() + "\n", encoding="utf-8")
    _print(f"{len(items)} entr{'y' if len(items) == 1 else 'ies'} from {len(sections)} Unreleased section(s):",
           *[f"  {c}" for c in created])
    if not args.dry_run:
        print(f"Removed those sections from {cfg['changelog']}. Entries without a type heading are drafts "
              "(type guessed as 'changed'): review them.")
    return 0


# ----------------------------------------------------------------------- bump


def cmd_bump(args) -> int:
    repo = Repo(args.repo)
    lines, _, _ = do_bump(repo, repo.config(), args.target, args.pre, args.dry_run)
    _print(*lines)
    return 0


def do_bump(repo: Repo, cfg: dict, target: str, pre: Optional[str] = None, dry_run: bool = False) -> tuple:
    """Returns (report lines, new version string, touched paths)."""
    scheme = Scheme(cfg.get("versioning"))
    if not cfg.get("version_files"):
        raise Fail("no version_files configured; add them to .changelog/config.json (or create a VERSION file)")
    states = version_states(repo, cfg, scheme)
    unreadable = [s for s in states if s["raw"] is None]
    if unreadable:
        raise Fail("cannot read: " + "; ".join(f"{s['path']}: {s['note']}" for s in unreadable))
    parsed = [s for s in states if s["version"]]
    if len({scheme.key(s["version"]) for s in parsed}) > 1:
        raise Fail("version files disagree, nothing written: " + ", ".join(f"{s['path']}={s['raw']}" for s in states))
    current = parsed[0]["version"] if parsed else None
    if target == "auto" or target in scheme.levels:
        unparsed = [s for s in states if s["version"] is None]
        if unparsed:
            raise Fail("these files do not fit the version format, so a level bump is impossible: " +
                       "; ".join(s["note"] for s in unparsed) + ". Pass an explicit version to convert them.")
        level = target
        if target == "auto":
            level = scheme.suggest(current, unreleased_items(analyze(repo, cfg)))["level"]
            if not level:
                raise Fail("nothing unreleased to base an automatic bump on")
        new = scheme.bump(current, level, pre)
    else:
        if pre:
            raise Fail("--pre goes with a level (e.g. `bump minor --pre beta`); write it into an explicit version instead")
        new = scheme.parse(target)
        if new is None:
            raise Fail(f"{target!r} is neither a level ({', '.join(['auto', *scheme.levels])}) nor a version in the "
                       f"format {scheme.format!r}")
    if current and scheme.key(new) <= scheme.key(current):
        raise Fail(f"{scheme.render(new)} is not greater than the current version {scheme.render(current)}")
    problems, plan = [], []
    for s in states:
        text = s["template"].render(new)
        kind = ecosystem(s["path"])
        if not fits_ecosystem(kind, text):
            problems.append(f"{s['path']}: {text!r} is not valid there ({ECOSYSTEMS[kind]}). Give the file its own "
                            f"format in config, e.g. {{\"path\": \"{s['path']}\", \"format\": "
                            f"\"{suggest_file_format(kind, scheme)}\"}}")
        plan.append((s, text))
    if problems:
        raise Fail("nothing written:\n  - " + "\n  - ".join(problems))
    old = scheme.render(current) if current else states[0]["raw"]
    out = [f"{old} -> {scheme.render(new)}{' (dry run)' if dry_run else ''}"]
    for s, text in plan:
        if not dry_run:
            write_version_file(repo.root, s["entry"], text)
        out.append(f"  {s['path']}: {s['raw']} -> {text}")
    lockfiles = [p for p in repo.tracked() if Path(p).name in LOCKFILES and len(Path(p).parts) <= 3]
    if lockfiles:
        out.append("Lockfiles that record the version (refresh after the user agrees):")
        out += [f"  {p}: {LOCKFILES[Path(p).name]}" for p in lockfiles]
    return out, scheme.render(new), [s["path"] for s in states]


# -------------------------------------------------------------------- compile


def render_entry(entry: dict, label: str = "") -> str:
    text = entry["text"].strip()
    first, *rest = text.splitlines()
    prefix = ("**Breaking:** " if entry.get("breaking") else "") + label
    lines = [f"- {prefix}{first}"] + [f"  {line}" if line.strip() else "" for line in rest]
    return "\n".join(lines)


def order_entries(entries: list, breaking_first: bool = False) -> list:
    if breaking_first:
        return sorted(entries, key=lambda e: (not e.get("breaking"), TYPES.index(e["type"])))
    return sorted(entries, key=lambda e: (TYPES.index(e["type"]), not e.get("breaking")))


def render_section(heading: Optional[str], summary: Optional[str], entries: list, group_by_type: bool,
                   internal_label: str = "For contributors") -> str:
    parts = [heading, ""] if heading else []
    if summary:
        parts += [summary.strip(), ""]
    ordered = order_entries(entries, breaking_first=not group_by_type)
    highlights = [e for e in ordered if e.get("highlight")]
    public = [e for e in ordered if e.get("audience", "user") != "internal" and not e.get("highlight")]
    internal = [e for e in ordered if e.get("audience", "user") == "internal" and not e.get("highlight")]
    if highlights:
        parts += (["### Highlights", ""] if group_by_type else []) + [render_entry(e) for e in highlights] + [""]
    if group_by_type:
        for t in TYPES:
            group = [e for e in public if e["type"] == t]
            if group:
                parts += [f"### {TITLES[t]}", "", *[render_entry(e) for e in group], ""]
        if internal:
            parts += [f"### {internal_label}", "", *[render_entry(e) for e in internal], ""]
    else:
        parts += [render_entry(e) for e in public]
        parts += [render_entry(e, f"{internal_label}: ") for e in internal] + [""]
    return "\n".join(parts).rstrip() + "\n"


def cmd_compile(args) -> int:
    repo = Repo(args.repo)
    lines, _ = do_compile(repo, repo.config(), args.version, args.date, args.summary, args.dry_run,
                          args.allow_drafts, args.skip_unreachable)
    _print(*lines)
    return 0


def do_compile(repo: Repo, cfg: dict, version_arg: str, date: Optional[str], summary: Optional[str],
               dry_run: bool = False, allow_drafts: bool = False, skip_unreachable: bool = False) -> tuple:
    """Returns (report lines, touched paths)."""
    scheme = Scheme(cfg.get("versioning"))
    parsed_version = scheme.parse(version_arg)
    if parsed_version is None:
        raise Fail(f"{version_arg!r} does not match this repo's version format {scheme.format!r}")
    version = scheme.render(parsed_version)
    date = date or dt.date.today().isoformat()
    an = analyze(repo, cfg)
    problems = []
    if an.drafts and not allow_drafts:
        problems.append(f"{len(an.drafts)} commit(s) have no fragment: " +
                        ", ".join(f"{d.commits[0].short} {_clip(d.subject, 40)!r}" for d in an.drafts) +
                        ". Write fragments (`new --commits`), `skip` them, or `materialize` and polish.")
    drafts = [f for f in an.fragments if f.draft]
    if drafts and not allow_drafts:
        problems.append("draft fragments need polishing (remove `draft: true` when done): " +
                        ", ".join(f.path.name for f in drafts))
    invalid = [f for f in an.fragments if f.problems]
    if invalid:
        problems.append("invalid fragments: " + "; ".join(f"{f.path.name}: {', '.join(f.problems)}" for f in invalid))

    tracked = set(repo.tracked(UNRELEASED))
    included, excluded = [], []
    for f in an.fragments:
        if f.problems:
            continue
        rel = repo.rel(f.path)
        if rel in tracked or not f.commits or any(repo.ok("merge-base", "--is-ancestor", ref, "HEAD") for ref in f.commits):
            included.append(f)
        else:
            excluded.append(f)
    if excluded and not skip_unreachable:
        problems.append("untracked fragments whose commits are not on this branch (another branch's work?): " +
                        ", ".join(f.path.name for f in excluded) + ". Delete them, or pass --skip-unreachable to "
                        "leave them in unreleased/.")
    if not included and not problems:
        problems.append("no fragments to release")

    changelog_path = repo.root / cfg["changelog"]
    text = changelog_path.read_text(encoding="utf-8") if changelog_path.is_file() else changelog_header(scheme.format)
    if _unreleased_headings(text):
        problems.append(f"{cfg['changelog']} still has 'Unreleased' section(s); run `adopt` first so their entries "
                        "are not lost or duplicated")
    history = load_history(repo)
    if any(v.get("version") == version for v in history.get("versions", [])):
        problems.append(f"{version} is already in {DIR}/changelog.json")
    if problems:
        raise Fail("compile stopped:\n  - " + "\n  - ".join(problems))

    entries = []
    for f in included:
        commits = f.commits or ([an.added_by[repo.rel(f.path)]] if repo.rel(f.path) in an.added_by else [])
        entries.append({"type": f.type, "text": f.text, "breaking": f.breaking, "audience": f.audience,
                        "highlight": f.highlight, "commits": commits})
    entries = order_entries(entries)
    heading = cfg["heading_format"].replace("{version}", version).replace("{date}", date)
    section = render_section(heading, summary, entries, bool(cfg.get("group_by_type", True)),
                             cfg.get("internal_label") or "For contributors")

    lines = text.splitlines()
    idx = next((i for i, line in enumerate(lines) if line.startswith("## ")), None)
    if idx is None:
        new_text = text.rstrip() + "\n\n" + section
    else:
        new_text = "\n".join(lines[:idx]).rstrip() + "\n\n" + section + "\n" + "\n".join(lines[idx:]).rstrip() + "\n"

    record = {"version": version, "date": date, "summary": (summary or "").strip(), "entries": entries}
    history["versions"] = [record] + [v for v in history.get("versions", []) if v.get("version") != version]

    archive = repo.released / version
    out = [f"Release {version} ({date}): {len(entries)} entr{'y' if len(entries) == 1 else 'ies'}"
           f"{' (dry run)' if dry_run else ''}", "", section]
    if dry_run:
        out.append(f"Would update {cfg['changelog']}, {DIR}/changelog.json"
                   f"{', ' + cfg['whats_new_path'] if cfg.get('whats_new_path') else ''}, and move "
                   f"{len(included)} fragment(s) to {repo.rel(repo.dir)}/released/{version}/")
        return out, []

    changelog_path.write_text(new_text, encoding="utf-8")
    repo.json_path.write_text(json.dumps(history, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if cfg.get("whats_new_path"):
        wn = repo.root / cfg["whats_new_path"]
        wn.parent.mkdir(parents=True, exist_ok=True)
        wn.write_text(json.dumps(whats_new(history), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if repo.released.is_dir():
        shutil.rmtree(repo.released)
    archive.mkdir(parents=True)
    for f in included:
        shutil.move(str(f.path), str(archive / f.path.name))
    if repo.skipped_path.is_file():
        shutil.move(str(repo.skipped_path), str(archive / "skipped.txt"))
    out.append(f"Updated {cfg['changelog']} and {DIR}/changelog.json"
               f"{' and ' + cfg['whats_new_path'] if cfg.get('whats_new_path') else ''}; "
               f"moved {len(included)} fragment(s) to {repo.rel(archive)}/.")
    out.append(f"Next: review the section, then commit, e.g. `git add -A {DIR} {cfg['changelog']} "
               f"<version files> && git commit -m \"chore(release): v{version}\"`.")
    touched = [DIR, cfg["changelog"]] + ([cfg["whats_new_path"]] if cfg.get("whats_new_path") else [])
    return out, touched


def whats_new(history: dict) -> dict:
    versions = []
    for v in history.get("versions", []):
        entries = [{"type": e["type"], "text": e["text"], "breaking": bool(e.get("breaking")),
                    "highlight": bool(e.get("highlight"))}
                   for e in v.get("entries", []) if e.get("audience", "user") == "user"]
        if entries or v.get("summary"):
            versions.append({"version": v["version"], "date": v.get("date"), "summary": v.get("summary", ""),
                             "entries": entries})
    return {"versions": versions}


def cmd_notes(args) -> int:
    repo = Repo(args.repo)
    cfg = repo.config()
    history = load_history(repo)
    wanted = {args.version, args.version[1:] if args.version[:1] in "vV" else args.version}
    record = next((v for v in history.get("versions", []) if v.get("version") in wanted), None)
    if record is None:
        raise Fail(f"{args.version} is not in {DIR}/changelog.json (compile it first)")
    entries = [e for e in record.get("entries", []) if args.audience == "all" or e.get("audience", "user") == "user"]
    print(render_section(None, record.get("summary"), entries, True, cfg.get("internal_label") or "For contributors")
          .rstrip())
    return 0


def cmd_check(args) -> int:
    """CI gate: fail when commits lack a fragment or fragments are drafts/invalid."""
    repo = Repo(args.repo)
    cfg = repo.config()
    an = analyze(repo, cfg, revs=[args.range] if args.range else None)
    problems = [f"{','.join(c.short for c in d.commits)} {d.subject!r} has no changelog fragment" for d in an.drafts]
    problems += [f"{c.short} {c.subject!r} is covered only by the draft {f.path.name}" for c, f in an.draft_only]
    problems += [f"{f.path.name} is still a draft" for f in an.fragments if f.draft and
                 not any(f is owner for _, owner in an.draft_only)]
    problems += [f"{f.path.name}: {'; '.join(f.problems)}" for f in an.fragments if f.problems]
    scope = args.range or an.baseline_label
    if problems:
        _print(f"changelog check failed ({scope}):", *[f"  - {p}" for p in problems],
               "Add a fragment in .changelog/unreleased/ (see .changelog/README.md), or put [skip changelog] in the "
               "commit message when users will not notice the change.")
        return 1
    print(f"changelog check passed ({scope}): {len(an.commits)} commit(s), {len(an.fragments)} fragment(s)")
    return 0


def cmd_release(args) -> int:
    """Non-interactive bump + compile (+ commit, + tag) for CI. Agents use bump/compile step by step instead."""
    repo = Repo(args.repo)
    cfg = repo.config()
    scheme = Scheme(cfg.get("versioning"))
    an = analyze(repo, cfg)
    if args.target == "auto" and not unreleased_items(an):
        print("nothing to release")
        return 0
    bump_lines, version, version_files = do_bump(repo, cfg, args.target, args.pre, dry_run=True)
    do_compile(repo, cfg, version, args.date, args.summary, dry_run=True, allow_drafts=args.allow_drafts)
    if args.dry_run:
        _print(*bump_lines, f"would compile and release {version}")
        return 0
    bump_lines, version, version_files = do_bump(repo, cfg, args.target, args.pre)
    compile_lines, touched = do_compile(repo, cfg, version, args.date, args.summary, allow_drafts=args.allow_drafts)
    out = bump_lines + compile_lines[:1]
    if args.commit or args.tag:
        repo.git("add", "-A", "--", *sorted(set(version_files + touched)))
        repo.git("commit", "-q", "-m", f"chore(release): v{version}")
        out.append(f"committed chore(release): v{version}")
    if args.tag:
        tag = (cfg.get("tag_format") or "v{version}").replace("{version}", version)
        repo.git("tag", "-a", tag, "-m", tag)
        out.append(f"tagged {tag}")
    _print(*out)
    return 0


def cmd_vendor(args) -> int:
    """Copy this script into .changelog/ so CI can run it without the skill installed."""
    repo = Repo(args.repo)
    repo.config()
    target = repo.dir / "changelogger.py"
    shutil.copyfile(SCRIPT, target)
    target.chmod(0o755)
    print(f"{repo.rel(target)} (run in CI as: python3 {repo.rel(target)} <command>)")
    return 0


# ----------------------------------------------------------------------- hooks


def hook_target(repo: Repo) -> Path:
    origin_value = repo.git("config", "--show-origin", "--get", "core.hooksPath", check=False)
    if origin_value:
        origin, _, value = origin_value.partition("\t")
        origin_path = origin[len("file:"):] if origin.startswith("file:") else ""
        common = Path(repo.git("rev-parse", "--git-common-dir"))
        common = common if common.is_absolute() else (repo.root / common)
        local = origin_path and (repo.root / origin_path).resolve().parent == common.resolve()
        if not local:
            raise Fail(f"core.hooksPath is set outside this repository ({origin}); installing there would affect "
                       "every repository. Add the hook block by hand or unset core.hooksPath.")
        if value.rstrip("/").endswith(".husky/_"):
            return repo.root / ".husky" / "post-commit"
    hooks = Path(repo.git("rev-parse", "--git-path", "hooks"))
    return (hooks if hooks.is_absolute() else repo.root / hooks) / "post-commit"


def cmd_hooks(args) -> int:
    repo = Repo(args.repo)
    target = hook_target(repo)
    text = target.read_text(encoding="utf-8") if target.is_file() else ""
    installed = HOOK_START in text
    shim = shutil.which("changelogger") or (str(Path.home() / ".local/bin/changelogger")
                                            if (Path.home() / ".local/bin/changelogger").exists() else None)
    link = f'ln -s "{SCRIPT}" ~/.local/bin/changelogger'
    if args.action == "status":
        _print(f"post-commit hook: {'on' if installed else 'off'} ({target})",
               f"changelogger command: {shim or f'missing (create it with `{link}`)'}")
        return 0
    if args.action == "on":
        if not repo.initialized:
            raise Fail(f"run `init` first; the hook only acts in repos with {DIR}/config.json")
        if installed:
            print(f"already on ({target})")
            return 0
        target.parent.mkdir(parents=True, exist_ok=True)
        if not text:
            text = "#!/bin/sh\n"
        elif not text.endswith("\n"):
            text += "\n"
        target.write_text(text + "\n" + HOOK_BLOCK, encoding="utf-8")
        target.chmod(target.stat().st_mode | 0o111)
        print(f"on: {target}")
        if not shim:
            print("Note: the `changelogger` command is not installed yet, so the hook stays inactive. Create it with "
                  f"`{link}` (or the repo's scripts/install).")
        return 0
    if not installed:
        print(f"already off ({target})")
        return 0
    pattern = re.compile(r"\n?" + re.escape(HOOK_START) + r".*?" + re.escape(HOOK_END) + r"\n?", re.S)
    remaining = pattern.sub("\n", text).strip()
    if remaining in ("", "#!/bin/sh", "#!/usr/bin/env sh", "#!/bin/bash"):
        target.unlink()
    else:
        target.write_text(remaining + "\n", encoding="utf-8")
    print(f"off: {target}")
    return 0


# ------------------------------------------------------------------------ main


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="changelogger", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-C", dest="repo", default=".", help="run as if started in this directory")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("init", help="set up .changelog/ (use --dry-run first)")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--force", action="store_true", help="regenerate an existing config.json")
    p.add_argument("--version-file", action="append", help="version file to bump (repeatable; overrides detection)")
    p.add_argument("--changelog", help="changelog path (default: detected, else CHANGELOG.md)")
    p.add_argument("--whats-new", help="path of the user-facing What's new JSON inside the app")
    p.add_argument("--baseline", default="auto", help="auto (latest version tag, else HEAD) | head | root | <rev>")
    p.add_argument("--tag-format", default="v{version}")
    p.add_argument("--scheme", choices=sorted(PRESETS),
                   help="versioning preset: semver 1.4.2 | semver-hotfix 1.4.2.hotfix-1 | two-part 1.4 | "
                        "build 0.1.2893 (build counts every release)")
    p.add_argument("--version-format", help="custom format, e.g. '{major}.{minor}[.hotfix-{hotfix}]' "
                                             "([...] only shows when non-zero)")
    p.add_argument("--counter", help="component that never resets and grows with every release (e.g. build)")
    p.add_argument("--bump-rule", action="append",
                   help="KEY=LEVEL: which level a change bumps; KEY is breaking, a fragment type, or default")
    p.add_argument("--file-format", action="append",
                   help="PATH=FORMAT: how one version file stores the version (e.g. package.json needs SemVer)")
    p.add_argument("--heading-format", help="changelog heading, e.g. '## v{version} ({date})'")
    p.add_argument("--ignore", action="append", help="extra regex; matching commit messages are ignored")
    p.add_argument("--normalize", action="append", help="regex removed from subjects before drafting/deduping")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("status", help="fragments, uncovered commits, suggested version")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_status)

    p = sub.add_parser("new", help="write a fragment")
    p.add_argument("--type", required=True, choices=TYPES)
    p.add_argument("--text", required=True, help="entry text; '-' reads stdin")
    p.add_argument("--commits", help="comma-separated commits this entry covers (refs like HEAD work)")
    p.add_argument("--breaking", action="store_true")
    p.add_argument("--audience", choices=("user", "internal"), default="user")
    p.add_argument("--slug", help="file name hint")
    p.add_argument("--highlight", action="store_true", help="feature this entry at the top of its release")
    p.set_defaults(func=cmd_new)

    p = sub.add_parser("skip", help="record commits that deliberately get no fragment")
    p.add_argument("commits", nargs="+")
    p.set_defaults(func=cmd_skip)

    p = sub.add_parser("materialize", help="write derived drafts as draft fragments")
    p.add_argument("--range", help="rev range for backfill, e.g. v1.2.0..HEAD (default: since baseline)")
    p.set_defaults(func=cmd_materialize)

    p = sub.add_parser("adopt", help="turn 'Unreleased' sections of the changelog into fragments")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_adopt)

    p = sub.add_parser("bump", help="set the version in every configured version file")
    p.add_argument("target", help="auto | a level of the repo's format (major, minor, patch, hotfix, ...) | "
                                  "an explicit version")
    p.add_argument("--pre", help="pre-release label, e.g. beta -> <version>-beta.1")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_bump)

    p = sub.add_parser("compile", help="release: write the changelog section and archive fragments")
    p.add_argument("version")
    p.add_argument("--date", help="YYYY-MM-DD (default: today)")
    p.add_argument("--summary", help="one or two sentences shown above the entries")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--allow-drafts", action="store_true", help="release even with uncovered commits/draft fragments")
    p.add_argument("--skip-unreachable", action="store_true", help="leave other-branch fragments in unreleased/")
    p.set_defaults(func=cmd_compile)

    p = sub.add_parser("notes", help="release notes for a compiled version (e.g. GitHub Release body)")
    p.add_argument("version")
    p.add_argument("--audience", choices=("user", "all"), default="user")
    p.set_defaults(func=cmd_notes)

    p = sub.add_parser("check", help="CI gate: fail if commits lack fragments or fragments are drafts")
    p.add_argument("--range", help="rev range to check, e.g. origin/main..HEAD in a pull request")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("release", help="CI: bump + compile (+ --commit, --tag) in one non-interactive step")
    p.add_argument("target", nargs="?", default="auto", help="auto (default) | a level | an explicit version")
    p.add_argument("--pre")
    p.add_argument("--summary")
    p.add_argument("--date")
    p.add_argument("--commit", action="store_true", help="commit the release as chore(release): v<version>")
    p.add_argument("--tag", action="store_true", help="also create the tag (implies --commit)")
    p.add_argument("--allow-drafts", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_release)

    p = sub.add_parser("vendor", help="copy this script to .changelog/changelogger.py for CI")
    p.set_defaults(func=cmd_vendor)

    p = sub.add_parser("hooks", help="opt-in git post-commit hook that writes draft fragments")
    p.add_argument("action", choices=("on", "off", "status"))
    p.set_defaults(func=cmd_hooks)

    p = sub.add_parser("post-commit", help=argparse.SUPPRESS)
    p.set_defaults(func=cmd_post_commit)
    return parser


def main(argv: Optional[list] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except Fail as exc:
        print(f"changelogger: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
