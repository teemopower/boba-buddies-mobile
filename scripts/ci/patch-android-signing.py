#!/usr/bin/env python3
"""Patch the prebuild-generated android/app/build.gradle so the release
build is signed with the EAS release keystore (android/keystore.properties).

`npx expo prebuild` regenerates android/ from the template, which drops the
manual signing edit that lives in the local android/ tree. This script
re-applies that edit after prebuild, in CI (and locally, if needed).

Idempotent: if the keystore.properties wiring is already present, no-op.
Exits non-zero if the expected template shapes are not found.
"""
import sys
from pathlib import Path

GRADLE = Path("android/app/build.gradle")

RELEASE_BLOCK = """        release {
            // Release signing with the release keystore (android/keystore.properties,
            // mode 600, gitignored — same keystore Codemagic holds, so the AAB
            // matches the Play listing's signing key).
            def keystoreProperties = new Properties()
            def keystorePropertiesFile = rootProject.file('keystore.properties')
            if (keystorePropertiesFile.exists()) {
                keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
            }
            storeFile rootProject.file(keystoreProperties['storeFile'] ?: 'boba-buddies-release.keystore')
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
"""


def main() -> int:
    text = GRADLE.read_text()
    if "keystore.properties" in text:
        print("signing config already wired; nothing to patch")
        return 0

    # 1. Insert the release signingConfig right after the debug block
    #    inside signingConfigs { ... }.
    debug_end = text.find("keyPassword 'android'")
    if debug_end == -1:
        print("ERROR: could not find the debug signingConfig block", file=sys.stderr)
        return 1
    close_brace = text.find("\n        }", debug_end)
    if close_brace == -1:
        print("ERROR: could not find the end of the debug signingConfig block", file=sys.stderr)
        return 1
    insert_at = close_brace + len("\n        }")
    # text[insert_at] is the newline before signingConfigs' closing brace;
    # consume it so no blank line is left after the inserted block.
    rest = text[insert_at + 1:] if text[insert_at:insert_at + 1] == "\n" else text[insert_at:]
    text = text[:insert_at] + "\n" + RELEASE_BLOCK + rest

    # 2. Point the release buildType at signingConfigs.release.
    bt = text.find("buildTypes")
    if bt == -1:
        print("ERROR: could not find buildTypes", file=sys.stderr)
        return 1
    rel = text.find("release {", bt)
    if rel == -1:
        print("ERROR: could not find the release buildType", file=sys.stderr)
        return 1
    # Only look inside the release buildType (up to its closing brace at
    # the same indent); the debug buildType above it must stay untouched.
    region_end = text.find("\n        }", rel)
    region = text[rel:region_end]
    if "signingConfig signingConfigs.debug" in region:
        region = region.replace(
            "signingConfig signingConfigs.debug",
            "signingConfig signingConfigs.release",
            1,
        )
    elif "signingConfig" not in region:
        rel_line_end = text.find("\n", rel) + 1
        text = (
            text[:rel_line_end]
            + "            signingConfig signingConfigs.release\n"
            + text[rel_line_end:]
        )
        print("patched: inserted signingConfig into the release buildType")
        GRADLE.write_text(text)
        print("patched android/app/build.gradle: release signingConfig wired to keystore.properties")
        return 0
    else:
        print("ERROR: release buildType already has a non-debug signingConfig", file=sys.stderr)
        return 1
    text = text[:rel] + region + text[region_end:]
    GRADLE.write_text(text)
    print("patched android/app/build.gradle: release signingConfig wired to keystore.properties")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
