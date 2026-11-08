#!/usr/bin/env bash
set -euo pipefail
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!name:-}" ]]; then echo "Missing required macOS signing/notarization secret: $name" >&2; exit 1; fi
done
certificate="$RUNNER_TEMP/chista-signing.p12"
keychain="$RUNNER_TEMP/chista-signing.keychain-db"
keychain_password="$(uuidgen)"
trap 'rm -f "$certificate"' EXIT
python3 - <<'PY'
import base64, os
path = os.path.join(os.environ['RUNNER_TEMP'], 'chista-signing.p12')
with open(path, 'wb') as stream:
    os.chmod(path, 0o600)
    stream.write(base64.b64decode(os.environ['APPLE_CERTIFICATE'], validate=True))
PY
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$certificate" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
