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
