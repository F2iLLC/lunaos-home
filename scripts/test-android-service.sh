#!/usr/bin/env bash
set -euo pipefail
output="src-tauri/target/android-service-tests"
mkdir -p "$output"
javac -d "$output" scripts/android/vault/VaultService.java test/java/VaultServiceTest.java
java -cp "$output" io.github.f2illc.lunaos.home.preview.VaultServiceTest
