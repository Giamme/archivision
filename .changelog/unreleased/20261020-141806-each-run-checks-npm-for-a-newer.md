---
type: added
breaking: false
audience: user
commits: 
---
Each run checks npm for a newer archivision and, when there is one, says so on stderr with the command that updates it. It waits at most about 1.5 seconds, never breaks a command, and stays quiet offline, in CI and when stderr is piped; `--no-update-check` or `ARCHIVISION_NO_UPDATE_CHECK=1` turns it off.
