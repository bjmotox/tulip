#!/bin/bash
tap test/unit/*.js

echo "what is the build version?"
read VERSION
echo "building tulip $VERSION for OSX"
electron-packager . --appname=tulip --platform=darwin --arch=x64 --icon=tulip-logo.ico --app-version=$VERSION -electron-version=1.2.4 --overwrite
echo "building tulip $VERSION for Windows"
electron-packager . --appname=tulip --platform=win32 --arch=x64 --icon=tulip-logo.ico --app-version=$VERSION -electron-version=1.2.4 --overwrite

echo "tulip builds complete!"
