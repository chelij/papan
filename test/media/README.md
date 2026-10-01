# Video fixture

`av1.mp4` is a one-second synthetic test pattern generated for this project, with no third-party footage:

```sh
ffmpeg -f lavfi -i testsrc2=size=128x96:rate=12 -t 1 -c:v libaom-av1 -cpu-used 8 -crf 45 av1.mp4
```

The release packaging check decodes it with the compiled FFmpeg/dav1d and encodes the same H.264 format used by previews. This catches a build that links successfully but lacks a working software AV1 decoder. Test fixtures are excluded from the installed app.

`portrait.mp4` is a one-second solid red 720×1280 H.264 video. The download test converts it through the production preview pipeline and checks decoded pixels, catching a scaler that exits successfully but corrupts YUV colors.

```sh
ffmpeg -f lavfi -i color=c=red:s=720x1280:r=24 -t 1 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart portrait.mp4
```
