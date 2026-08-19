# Distributing StreamScope

This documents how to ship StreamScope to real users. The app already builds an
optimized native binary and a `.app` bundle; the remaining steps below need a
paid Apple Developer account (macOS) and/or a code-signing certificate
(Windows), which is why they live here rather than in an automated build.

## 1. Build artifacts

```bash
export PKG_CONFIG_PATH="/opt/homebrew/opt/librdkafka/lib/pkgconfig:$PKG_CONFIG_PATH"

# Binary + .app only (fast, what we verify in dev):
pnpm tauri build --no-bundle

# Full bundles (.dmg on macOS, .msi/.exe on Windows, .deb/.AppImage on Linux):
pnpm tauri build
```

> Note: on this machine, the `.dmg` step (`bundle_dmg.sh`) can fail due to disk
> image permissions in a restricted environment. The `.app` still builds and
> runs. On a normal dev machine or CI runner the `.dmg` step works.

## 2. librdkafka is a dynamic dependency

The binary links against Homebrew's `librdkafka.1.dylib`. For distribution you
must either:

- **Bundle the dylib** and fix the load path (`install_name_tool` /
  `@rpath`), or
- Switch the `rdkafka` feature to a **static build** (`features = ["cmake-build"]`,
  which requires `cmake` at build time) so nothing external is needed at runtime.

Static linking is the recommended path for shipping; dynamic linking is used in
dev for fast builds.

## 3. macOS code signing + notarization

Requires an Apple Developer account ($99/yr) and a "Developer ID Application"
certificate. Tauri reads these from env vars:

```bash
export APPLE_CERTIFICATE="<base64 .p12>"
export APPLE_CERTIFICATE_PASSWORD="…"
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="<app-specific password>"
export APPLE_TEAM_ID="TEAMID"

pnpm tauri build   # signs + notarizes automatically when these are set
```

Without notarization, macOS Gatekeeper warns users on first launch.

## 4. Windows code signing

Provide a code-signing certificate and configure `bundle.windows.certificateThumbprint`
(or sign the produced `.exe`/`.msi` in CI). Unsigned installers trigger
SmartScreen warnings.

## 5. Auto-update

Tauri's updater plugin (`@tauri-apps/plugin-updater` + `tauri-plugin-updater`)
serves signed updates from a static JSON manifest. Steps:

1. Add the updater plugin to `Cargo.toml` and `lib.rs`.
2. Generate an update signing keypair (`pnpm tauri signer generate`).
3. Set `plugins.updater` in `tauri.conf.json` with the public key and endpoint.
4. Host `latest.json` + the signed bundles (GitHub Releases works well).

## 6. Suggested release flow (CI)

1. Tag a version → GitHub Actions matrix (macOS, Windows, Linux).
2. Each runner: `pnpm install`, install librdkafka (or static build), `pnpm tauri build`.
3. Sign/notarize using repository secrets.
4. Upload bundles + `latest.json` to the GitHub Release.

## Pricing / licensing (planned)

Free tier (limited connections) + one-time personal license with a year of
updates, TablePlus-style. A lightweight license check can gate pro features
behind a signed key validated locally (offline-friendly).
