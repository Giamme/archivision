---
type: security
breaking: false
audience: user
commits: 
---
A user name, password or token in the repo's origin URL is no longer written into the page, and ssh remotes (`git@host:owner/repo`, `ssh://git@host:port/owner/repo`) now give working https links into the code; a remote that is a local path gives no GitHub links instead of broken ones.
