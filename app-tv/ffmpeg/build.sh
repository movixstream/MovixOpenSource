#!/usr/bin/env bash
# Construit libffmpegJNI.so (FFmpeg + pont JNI de Media3) pour les ABI de
# l'appli et la dépose dans src/main/jniLibs/. FFmpeg est compilé en LGPL
# (jamais --enable-gpl) avec les seuls décodeurs audio que les télés n'ont pas
# toujours : Dolby Digital (Plus), TrueHD et DTS.
#
# Prérequis : NDK Android (ANDROID_NDK_HOME), curl, tar, make.
set -euo pipefail

FFMPEG_VERSION=7.1.5
FFMPEG_SHA256=de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f
API=25 # minSdk de l'appli
ABIS=(armeabi-v7a arm64-v8a x86)
DECODERS=(ac3 eac3 truehd mlp dca)

here="$(cd "$(dirname "$0")" && pwd)"
ndk="${ANDROID_NDK_HOME:?ANDROID_NDK_HOME : chemin du NDK Android}"
host="$(uname -s | tr '[:upper:]' '[:lower:]')-x86_64"
bin="$ndk/toolchains/llvm/prebuilt/$host/bin"
work="$here/build"
jobs="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"

mkdir -p "$work"
tarball="$work/ffmpeg-$FFMPEG_VERSION.tar.xz"
[[ -f "$tarball" ]] || curl -fsSL -o "$tarball" "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"
echo "$FFMPEG_SHA256  $tarball" | sha256sum -c -
src="$work/ffmpeg-$FFMPEG_VERSION"
[[ -d "$src" ]] || tar -xJf "$tarball" -C "$work"

common=(
  --target-os=android --enable-cross-compile --enable-static --disable-shared --enable-pic
  --disable-autodetect --disable-doc --disable-programs --disable-everything
  --disable-avdevice --disable-avformat --disable-swscale --disable-postproc --disable-avfilter
  --disable-network --disable-symver --disable-v4l2-m2m --disable-vulkan --enable-swresample
  --nm="$bin/llvm-nm" --ar="$bin/llvm-ar" --ranlib="$bin/llvm-ranlib" --strip="$bin/llvm-strip"
)
for d in "${DECODERS[@]}"; do common+=(--enable-decoder="$d"); done

for abi in "${ABIS[@]}"; do
  case "$abi" in
    armeabi-v7a) triple=armv7a-linux-androideabi; arch=(--arch=arm --cpu=armv7-a --extra-cflags="-march=armv7-a -mfloat-abi=softfp") ;;
    arm64-v8a) triple=aarch64-linux-android; arch=(--arch=aarch64 --cpu=armv8-a) ;;
    x86) triple=i686-linux-android; arch=(--arch=x86 --cpu=i686 --disable-asm) ;;
  esac
  out="$work/$abi"
  (
    cd "$src"
    make distclean >/dev/null 2>&1 || true
    ./configure --prefix="$out" --cc="$bin/$triple$API-clang" --cxx="$bin/$triple$API-clang++" "${arch[@]}" "${common[@]}"
    make -j"$jobs"
    make install-libs install-headers
  )
  # Pont JNI : mêmes options que le CMakeLists.txt de Media3.
  mkdir -p "$here/src/main/jniLibs/$abi"
  "$bin/$triple$API-clang++" -std=c++11 -O2 -fPIC -shared -fvisibility=hidden -fvisibility-inlines-hidden \
    -I"$out/include" "$here/jni/ffmpeg_jni.cc" \
    "$out/lib/libswresample.a" "$out/lib/libavcodec.a" "$out/lib/libavutil.a" \
    -landroid -llog -lm -static-libstdc++ -Wl,--gc-sections -Wl,--exclude-libs,ALL -Wl,-Bsymbolic -Wl,-z,max-page-size=16384 \
    -o "$here/src/main/jniLibs/$abi/libffmpegJNI.so"
  "$bin/llvm-strip" --strip-unneeded "$here/src/main/jniLibs/$abi/libffmpegJNI.so"
done
ls -l "$here"/src/main/jniLibs/*/libffmpegJNI.so
