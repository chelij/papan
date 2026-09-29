#!/usr/bin/env bash
set -euo pipefail

# Run from the Papan repository root. On Windows, use MSYS2 MINGW64.
root=$(pwd)
tar_options=(-x)
case "$(uname -s)" in
  MINGW*|MSYS*) root=$(cygpath -u "$root"); tar_options+=(--force-local) ;;
esac
work="$root/build/ffmpeg"
prefix="$work/install"
mkdir -p "$work/x264" "$work/ffmpeg" "$work/dav1d" "$prefix"
tar "${tar_options[@]}" -f "$root/vendor/native-source/x264-baee400.tar.gz" -C "$work/x264" --strip-components=1
tar "${tar_options[@]}" -f "$root/vendor/native-source/ffmpeg-7.0.2.tar.xz" -C "$work/ffmpeg" --strip-components=1
tar "${tar_options[@]}" -f "$root/vendor/native-source/dav1d-1.4.2.tar.gz" -C "$work/dav1d" --strip-components=1
jobs=${PAPAN_BUILD_JOBS:-4}
x264_flags=(--prefix="$prefix" --enable-static --disable-cli --disable-opencl --bit-depth=8)
ffmpeg_flags=(--prefix="$prefix" --disable-autodetect --disable-doc --disable-debug --disable-shared --enable-static
  --enable-gpl --enable-libx264 --enable-libdav1d --disable-ffplay --disable-network
  --pkg-config-flags=--static --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib")
case "$(uname -s)" in
  MINGW*|MSYS*) x264_flags+=(--host=x86_64-w64-mingw32); ffmpeg_flags+=(--target-os=mingw32 --extra-ldflags=-static); extension=.exe ;;
  *) extension= ;;
esac
assembly=true
if ! command -v nasm >/dev/null 2>&1; then
  assembly=false
  x264_flags+=(--disable-asm)
  ffmpeg_flags+=(--disable-x86asm)
fi
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
meson setup "$work/dav1d-build" "$work/dav1d" --prefix="$prefix" --libdir=lib --default-library=static -Denable_tools=false -Denable_tests=false -Denable_asm="$assembly"
meson compile -C "$work/dav1d-build" -j "$jobs"
meson install -C "$work/dav1d-build"
cd "$work/x264"
./configure "${x264_flags[@]}"
make -j"$jobs"
make install
cd "$work/ffmpeg"
./configure "${ffmpeg_flags[@]}"
make -j"$jobs"
cp "ffmpeg$extension" "$root/vendor/ffmpeg$extension"
cp "ffprobe$extension" "$root/vendor/ffprobe$extension"
cp COPYING.GPLv2 "$root/vendor/native-source/FFmpeg-LICENSE"
cp "$work/x264/COPYING" "$root/vendor/native-source/x264-LICENSE"
cp "$work/dav1d/COPYING" "$root/vendor/native-source/dav1d-LICENSE"
cp "$work/dav1d-build/meson-info/intro-buildoptions.json" "$root/vendor/native-source/dav1d-options.json"
cp ffbuild/config.mak "$root/vendor/native-source/ffmpeg-config.mak"
cp "$work/x264/config.mak" "$root/vendor/native-source/x264-config.mak"
"$root/vendor/ffmpeg$extension" -version > "$root/vendor/native-source/ffmpeg-version.txt"
