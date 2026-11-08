# Publishing installers

The [release workflow](../.github/workflows/release.yml) validates the source, builds a universal macOS disk image and a Windows x64 NSIS setup executable on their native GitHub runners, and publishes them to [GitHub Releases](https://github.com/hadiranjbar25/chista/releases).

## Create a release

1. Set the same version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Update the corresponding lockfile versions when bumping a version.
2. Update `.github/RELEASE_NOTES.md` with the release's changes and platform limitations.
3. Commit and push the changes to `main`.
4. In **Actions → Build and publish installers**, select **Run workflow** on `main`. Alternatively, push a tag that matches the version, such as `v0.1.0`.

Both installer builds must succeed before the publish job runs. It creates a draft release, uploads the `.dmg`, `-setup.exe`, and `SHA256SUMS.txt`, then publishes the release. The workflow's `GITHUB_TOKEN` needs `contents: write` only in the publish job; no personal token or signing secrets are required for unsigned builds.

An existing published version cannot be overwritten by a rerun. Fix a failed build and rerun its jobs, or bump the version for a new published release. If an upload fails after a draft was created, the workflow can reuse that draft.

## Signing and verification

Current releases are unsigned and the Mac app is not notarized. Before changing that claim, configure the signing credentials in GitHub Actions and verify signed downloads on the destination platforms. See [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/) and [Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

Build success is separate from runtime verification. Check installation, first launch, CLI detection, sign-in, and a real debug conversation on each supported OS and processor. Release notes should state which platforms have actually been verified.

For local packaging commands, see [Build an installer](INSTALL.md#build-an-installer).

## Required signing secrets

Installer CI now fails closed if signing credentials are missing. Local development builds do not require signing secrets.

macOS GitHub Actions secrets: `APPLE_CERTIFICATE` (base64 Developer ID Application P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (app-specific password), and `APPLE_TEAM_ID`. The workflow imports the certificate into a temporary keychain, builds with hardened runtime, notarizes through Tauri, verifies codesign and the stapled ticket, then deletes the keychain. Configure the identity for `dev.chista.desktop` and authorize notarization with the Apple account. See [Tauri macOS signing](https://v2.tauri.app/distribute/sign/macos/).

Windows GitHub Actions secrets: `WINDOWS_CERTIFICATE` (base64 code-signing PFX with private key) and `WINDOWS_CERTIFICATE_PASSWORD`. CI imports into CurrentUser/My and generates a temporary Tauri signing configuration using its thumbprint, SHA-256, and a timestamp authority. It verifies the final installer's Authenticode signature before upload and removes the imported certificate. A hardware-backed certificate may require adapting `signCommand` to the certificate vendor's signer or Azure signing service; do not export an unexportable key. See [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/).

Use a protected release environment/repository secret policy and trusted runners. No signing keys or certificate files belong in source control. These scripts are configured but must be validated in macOS and Windows CI with your real identities; local unsigned build success does not validate notarization or Windows trust.
