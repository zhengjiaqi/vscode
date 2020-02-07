#!/bin/bash
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
	LINUX_NO_SANDBOX="--no-sandbox" # Electron 6 introduces a chrome-sandbox that requires root to run. This can fail. Disable sandbox via --no-sandbox.
fi

VSCODEUSERDATADIR=`mktemp -d 2>/dev/null`
cd $ROOT

# Figure out which Electron to use for running tests
if [ -z "$INTEGRATION_TEST_ELECTRON_PATH" ]
then
	# Run out of sources: no need to compile as code.sh takes care of it
	INTEGRATION_TEST_ELECTRON_PATH="./scripts/code.sh"

	echo "Running integration tests out of sources."
else
	# Run from a built: need to compile all test extensions
	yarn gulp compile-extension:vscode-api-tests
	yarn gulp compile-extension:vscode-colorize-tests
	yarn gulp compile-extension:markdown-language-features
	yarn gulp compile-extension:emmet
	yarn gulp compile-extension:css-language-features-server
	yarn gulp compile-extension:html-language-features-server
	yarn gulp compile-extension:json-language-features-server
	yarn gulp compile-extension:git

	# Configuration for more verbose output
	export VSCODE_CLI=1
	export ELECTRON_ENABLE_STACK_DUMPING=1
	export ELECTRON_ENABLE_LOGGING=1

	echo "Running integration tests with '$INTEGRATION_TEST_ELECTRON_PATH' as build."
fi

# Integration tests in AMD
./scripts/test.sh --runGlob **/*.integrationTest.js "$@"

# Tests in the extension host
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $ROOT/extensions/vscode-api-tests/testWorkspace --enable-proposed-api=vscode.vscode-api-tests --extensionDevelopmentPath=$ROOT/extensions/vscode-api-tests --extensionTestsPath=$ROOT/extensions/vscode-api-tests/out/singlefolder-tests --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started --user-data-dir=$VSCODEUSERDATADIR
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $ROOT/extensions/vscode-api-tests/testworkspace.code-workspace --enable-proposed-api=vscode.vscode-api-tests --extensionDevelopmentPath=$ROOT/extensions/vscode-api-tests --extensionTestsPath=$ROOT/extensions/vscode-api-tests/out/workspace-tests --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started --user-data-dir=$VSCODEUSERDATADIR
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $ROOT/extensions/vscode-colorize-tests/test --extensionDevelopmentPath=$ROOT/extensions/vscode-colorize-tests --extensionTestsPath=$ROOT/extensions/vscode-colorize-tests/out --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started --user-data-dir=$VSCODEUSERDATADIR
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $ROOT/extensions/markdown-language-features/test-fixtures --extensionDevelopmentPath=$ROOT/extensions/markdown-language-features --extensionTestsPath=$ROOT/extensions/markdown-language-features/out/test --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started --user-data-dir=$VSCODEUSERDATADIR
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $(mktemp -d 2>/dev/null) --extensionDevelopmentPath=$ROOT/extensions/git --extensionTestsPath=$ROOT/extensions/git/out/test --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started --user-data-dir=$VSCODEUSERDATADIR

mkdir -p $ROOT/extensions/emmet/test-fixtures
"$INTEGRATION_TEST_ELECTRON_PATH" $LINUX_NO_SANDBOX $ROOT/extensions/emmet/test-fixtures --extensionDevelopmentPath=$ROOT/extensions/emmet --extensionTestsPath=$ROOT/extensions/emmet/out/test --disable-telemetry --disable-crash-reporter --disable-updates --disable-extensions --skip-getting-started  --user-data-dir=$VSCODEUSERDATADIR
rm -rf $ROOT/extensions/emmet/test-fixtures

# Remote Integration Tests
if [ -f ./resources/server/test/test-remote-integration.sh ]; then
	./resources/server/test/test-remote-integration.sh
fi

# Tests in commonJS
cd $ROOT/extensions/css-language-features/server && $ROOT/scripts/node-electron.sh test/index.js
cd $ROOT/extensions/html-language-features/server && $ROOT/scripts/node-electron.sh test/index.js

rm -r $VSCODEUSERDATADIR
