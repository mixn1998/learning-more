Learning MORE Portable for Windows x64

Start:
  Double-click START.cmd. The launcher binds only to 127.0.0.1 and opens the local application.

Local state:
  Data, runtime identity, logs, diagnostics, and DPAPI-protected provider secrets are stored under
  %LOCALAPPDATA%\Learning MORE. They are never written into this portable directory or included in
  the release archive.

Maintenance:
  Run tools\learning-more.cmd for offline verify, backup, doctor, migrate, and restore commands.
  Stop Learning MORE before a migration or whole-store restore.

Ports:
  43119 serves the local UI and restricted launcher control endpoints.
  43120 serves the local API and is reached through the 43119 same-origin proxy.

Limitations:
  This MVP is single-user, local-first, and has no cloud sync or multi-user login system.
