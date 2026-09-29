#!/bin/sh
# Copies the web game into the APK's assets. Run before building locally.
set -e
cd "$(dirname "$0")"
rm -rf app/src/main/assets/www
mkdir -p app/src/main/assets/www
cp -r ../index.html ../style.css ../manifest.webmanifest ../icons ../src ../vendor ../assets app/src/main/assets/www/
