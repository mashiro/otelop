#!/usr/bin/env bash
# Assembles release archives (tar.gz / darwin zip) and a combined checksums
# file from the per-target binaries the release build matrix produces.
#
# CGO (required by the DuckDB driver, see docs/design/duckdb-storage.md
# "Build and release impact") rules out a single cross-compiling goreleaser
# build step, so there is no goreleaser-tracked build artifact for its
# archive/checksum pipes to consume. This script is the replacement glue —
# only .github/workflows/release.yml's assemble step calls it; local
# snapshot builds go through `mise run release-snapshot` (plain
# `goreleaser build --single-target`), which never runs this script at all.
set -euo pipefail

version="${1:?usage: package-release.sh <version> <dist-dir> <out-dir>}"
dist_dir="${2:?usage: package-release.sh <version> <dist-dir> <out-dir>}"
out_dir="${3:?usage: package-release.sh <version> <dist-dir> <out-dir>}"

mkdir -p "$out_dir"
out_dir_abs="$(cd "$out_dir" && pwd)"

# The only caller (release.yml's assemble job) always runs on ubuntu-latest,
# which has sha256sum; no macOS/shasum fallback is ever exercised here.
sha256() {
  sha256sum "$@"
}

shopt -s nullglob
for dir in "$dist_dir"/*/; do
  target="$(basename "$dir")" # e.g. linux_amd64, darwin_arm64 (see release.yml's upload-artifact naming)
  goos="${target%_*}"
  goarch="${target#*_}"
  bin="$dir/otelop"
  chmod +x "$bin"

  # darwin uses zip, everything else tar.gz — matches the archive formats
  # the old .goreleaser.yml config used (format_overrides: darwin -> zip).
  if [ "$goos" = "darwin" ]; then
    out="$out_dir_abs/otelop_${version}_${goos}_${goarch}.zip"
    (cd "$dir" && zip -q -j "$out" otelop)
  else
    out="$out_dir_abs/otelop_${version}_${goos}_${goarch}.tar.gz"
    tar -C "$dir" -czf "$out" otelop
  fi
done

# Write the combined checksums file outside $out_dir first so the glob below
# (evaluated from inside $out_dir) can't accidentally include it.
tmp_checksums="$(mktemp)"
(cd "$out_dir_abs" && sha256 -- * > "$tmp_checksums")
mv "$tmp_checksums" "$out_dir_abs/otelop_${version}_checksums.txt"
