#!/bin/bash
# =====================================================================
#  Build Yooh.ipa (Release) — RUN ON macOS WITH Xcode 16+ INSTALLED.
#  Produces an UNSIGNED Release build for later signing/sideloading
#  (AltStore / Sideloadly / TrollStore tooling signs it on your PC).
#
#  Usage:  ./build_ipa.sh
#  Output: build/Yooh.ipa  (Payload/Yooh.app inside)
#          build/BUILD_INFO.txt
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJ="$ROOT/ios/Yooh/Yooh.xcodeproj"
SCHEME="Yooh"
CONFIG="Release"
BUILD_DIR="$ROOT/build"
DERIVED="$BUILD_DIR/derived"
APP_NAME="Yooh"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[ERROR] This script needs macOS with Xcode (xcodebuild). You are on $(uname)."
  exit 1
fi
command -v xcodebuild >/dev/null 2>&1 || { echo "[ERROR] xcodebuild not found. Install Xcode."; exit 1; }

mkdir -p "$BUILD_DIR"
rm -rf "$DERIVED" "$BUILD_DIR/Payload" "$BUILD_DIR/$APP_NAME.ipa"

echo "==> Building $SCHEME ($CONFIG, unsigned)..."
xcodebuild \
  -project "$PROJ" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

APP_PATH="$(find "$DERIVED/Build/Products/$CONFIG-iphoneos" -maxdepth 1 -name "$APP_NAME.app" | head -n 1)"
if [[ -z "${APP_PATH:-}" || ! -d "$APP_PATH" ]]; then
  echo "[ERROR] Built .app not found."
  exit 1
fi

echo "==> Packaging $APP_NAME.ipa ..."
mkdir -p "$BUILD_DIR/Payload"
cp -R "$APP_PATH" "$BUILD_DIR/Payload/"
(cd "$BUILD_DIR" && zip -qr "$APP_NAME.ipa" Payload)
unzip -l "$BUILD_DIR/$APP_NAME.ipa" | head -n 12

VERSION="$(defaults read "$APP_PATH/Info" CFBundleShortVersionString 2>/dev/null || echo 1.0)"
BUILD="$(defaults read "$APP_PATH/Info" CFBundleVersion 2>/dev/null || echo 1)"

cat > "$BUILD_DIR/BUILD_INFO.txt" <<EOF
Build date: $(date -u +%Y-%m-%dT%H:%M:%SZ)
App version: $VERSION
Build number: $BUILD
Scheme: $SCHEME
Configuration: $CONFIG
Deployment target: iOS 17.0
Server host: yooh-test.cloudpub.ru
Server port: 443 (public https via CloudPub; local backend :1111)
API URL: https://yooh-test.cloudpub.ru
WebSocket URL: wss://yooh-test.cloudpub.ru/socket.io/
Signing status: UNSIGNED (CODE_SIGNING_ALLOWED=NO) — sign with your Apple ID / sideload tool before installing
IPA path: build/$APP_NAME.ipa

Backend:  start.bat  (HOST=0.0.0.0 PORT=1111 ADMIN_PORT=1112 -> node src/server/index.js)
IPA:      ./build_ipa.sh  (xcodebuild Release, unsigned .app -> Payload -> zip)
EOF

echo "==> Done: $BUILD_DIR/$APP_NAME.ipa"
