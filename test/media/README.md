# Video fixture

`av1.mp4` is a one-second synthetic test pattern generated for this project, with no third-party footage:

```sh
ffmpeg -f lavfi -i testsrc2=size=128x96:rate=12 -t 1 -c:v libaom-av1 -cpu-used 8 -crf 45 av1.mp4
```

The release packaging check decodes it with the compiled FFmpeg/dav1d and encodes the same H.264 format used by previews. This catches a build that links successfully but lacks a working software AV1 decoder. Test fixtures are excluded from the installed app.
