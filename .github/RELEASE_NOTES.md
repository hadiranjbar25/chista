Desktop installers for Chista's safe debugging workspace.

| Download         | Platform                                 |
| ---------------- | ---------------------------------------- |
| `.dmg`           | macOS universal: Apple Silicon and Intel |
| `-setup.exe`     | Windows x64                              |
| `SHA256SUMS.txt` | Installer checksums                      |

On macOS, open the disk image and drag Chista into Applications. On Windows, run the setup executable.

These installers are unsigned. The Mac app is not Apple notarized. macOS Gatekeeper or Windows SmartScreen may block or warn on first launch. The Windows and Intel Mac packages are newly built and have not been verified on physical hardware.

Install Codex or Claude Code separately and complete its native sign-in, or configure a hosted model provider in Settings → Models. No Node.js or Rust installation is required for the packaged app itself.

Repository files are not uploaded automatically. Debug files, redaction mappings, and chat stay in memory for the app run. Workspaces and CLI credentials are not transferred by installing the app on another computer.

See the [installation guide](https://github.com/hadiranjbar25/chista/blob/main/docs/INSTALL.md) for agent setup, platform support, and troubleshooting.
