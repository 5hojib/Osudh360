#!/usr/bin/env node
/**
 * Adds a real release signing config to the generated Android project.
 *
 * `expo prebuild` regenerates `android/app/build.gradle` from the Expo
 * template on every run, and that template signs release builds with the
 * *debug* key - an APK no store will accept, and one that cannot be upgraded
 * in place later. Because prebuild always overwrites the file, this patch has
 * to run *after* prebuild rather than being committed as an edit.
 *
 * Credentials come from gradle.properties (`-P` flags or environment
 * variables), so nothing secret ends up in the repo.
 *
 * Idempotent: safe to run repeatedly against the same file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GRADLE = resolve(process.argv[2] ?? "android/app/build.gradle");
const MARKER = "OSUDH360_STORE_FILE";

let source = readFileSync(GRADLE, "utf8");

if (source.includes(MARKER)) {
  console.log("✓ release signing config already present");
  process.exit(0);
}

const RELEASE_SIGNING = `        release {
            // Injected by scripts/patch-android-signing.mjs — see that file.
            // Credentials come from gradle.properties / -P flags so nothing
            // secret is committed.
            def storePath = findProperty('${MARKER}')
            if (storePath != null && file(storePath).exists()) {
                storeFile file(storePath)
                storePassword findProperty('OSUDH360_STORE_PASSWORD')
                keyAlias findProperty('OSUDH360_KEY_ALIAS')
                keyPassword findProperty('OSUDH360_KEY_PASSWORD')
            }
        }
`;

const debugBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
`;

if (!source.includes(debugBlock)) {
  console.error(`✗ could not find the debug signingConfig in ${GRADLE}`);
  process.exit(1);
}

// 1. Add the release signingConfig next to the debug one.
source = source.replace(debugBlock, debugBlock + RELEASE_SIGNING);

// 2. Point the release build type at it, but only when a keystore was supplied.
const releaseBefore = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
`;
const releaseAfter = `        release {
            signingConfig findProperty('${MARKER}') != null
                ? signingConfigs.release
                : signingConfigs.debug
`;

if (!source.includes(releaseBefore)) {
  console.error(`✗ could not find the release buildType in ${GRADLE}`);
  process.exit(1);
}
source = source.replace(releaseBefore, releaseAfter);

writeFileSync(GRADLE, source);
console.log("✓ release signing config injected");