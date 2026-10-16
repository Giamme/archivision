"""Release helper, outside the code root: counted, not read."""


def bump(version: str) -> str:
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"
