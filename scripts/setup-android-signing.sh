#!/usr/bin/env bash
# Creates the Android upload key and registers it as GitHub Actions secrets,
# which is what the Android release workflow signs with.
#
#   ./scripts/setup-android-signing.sh
#
# The upload key is permanent: if it is lost, no future build can update the
# published app. It is written to mobile/android/ (git-ignored) and, when the
# `gh` CLI is available, pushed straight into the repository secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYSTORE="$ROOT/mobile/android/osudh360-release.keystore"
ALIAS="osudh360"
REPO="$(cd "$ROOT" && git remote get-url origin | sed -E 's#.*github.com[:/]+##; s#\.git$##')"

# Generated once and reused, so re-running does not orphan a published app.
if [ -f "$KEYSTORE" ]; then
  echo "→ reusing the existing upload key at $KEYSTORE"
  echo "  (delete that file first only if you really mean to start over)"
else
  echo "→ generating a new 2048-bit RSA upload key"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v -storetype PKCS12 \
    -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$ALIAS" -keypass "$ALIAS" \
    -dname "CN=Osudh360, OU=Mobile, O=Osudh360, L=Dhaka, ST=Dhaka, C=BD" > /dev/null 2>&1
fi

KEYSTORE_B64="$(base64 -w0 < "$KEYSTORE")"

printf 'Keystore : %s\nAlias    : %s\nPassword : %s\nRepo     : %s\n' \
  "$KEYSTORE" "$ALIAS" "$ALIAS" "${REPO:-<unset>}"

if ! command -v gh > /dev/null 2>&1; then
  cat <<'NOTE'

`gh` is not installed, so add these four repository secrets yourself under
Settings → Secrets and variables → Actions → New repository secret:

  ANDROID_KEYSTORE_BASE64   < the base64 of the keystore file
  ANDROID_KEYSTORE_PASSWORD $ALIAS
  ANDROID_KEY_ALIAS         $ALIAS
  ANDROID_KEY_PASSWORD      $ALIAS

To print the base64 value:

  base64 -w0 < mobile/android/osudh360-release.keystore

NOTE
  exit 0
fi

if ! gh auth status > /dev/null 2>&1; then
  cat <<'NOTE'

`gh` is installed but not authenticated. Run `gh auth login`, then re-run this
script — or add the four secrets through the web UI as described above.
NOTE
  exit 0
fi

echo "→ setting repository secrets"
printf '%s' "$KEYSTORE_B64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$ALIAS"        | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$ALIAS"        | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$ALIAS"        | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"

echo "✓ secrets set. Push a tag to build a signed release:"
echo "    git tag v1.0.0 && git push origin v1.0.0"