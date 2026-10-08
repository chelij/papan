# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Cheliyono Jenardi
"""Local whole-body pose worker. Models arrive as verified local ONNX files."""
import contextlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def emit(**event):
    print(json.dumps(event), flush=True)


def extract(request):
    import cv2
    import numpy as np
    from rtmlib import Wholebody, draw_skeleton

    stage = Path(request['stage']).resolve()
    segments = [Path(file).resolve() for file in request['segments']]
    models = [Path(file).resolve() for file in request['models']]
    options = request.get('options', {'personCount': 0, 'jointConfidence': 0.3})
    if not isinstance(options, dict) or type(options.get('personCount')) is not int or not 0 <= options['personCount'] <= 10 or type(options.get('jointConfidence')) not in (int, float) or not 0.1 <= options['jointConfidence'] <= 0.9:
        raise ValueError('Invalid pose cleanup settings.')
    threshold = options['jointConfidence']
    if not segments or any(file.parent != stage or file.name != f'source-{i:05d}.mp4' for i, file in enumerate(segments)):
        raise ValueError('Invalid pose video segments.')
    if len(models) != 2 or any(not file.is_file() for file in models):
        raise ValueError('The local pose models are missing. Retry extraction.')
    emit(progress='loading local DWPose models · CPU…')
    cv2.setNumThreads(min(8, os.cpu_count() or 1))
    with contextlib.redirect_stdout(sys.stderr):
        model = Wholebody(det=str(models[0]), det_input_size=(640, 640), pose=str(models[1]), pose_input_size=(288, 384),
                          to_openpose=True, backend='onnxruntime', device='cpu')
    frames = detected = max_people = 0
    tracked = [None] * options['personCount']
    missing = [0] * options['personCount']
    for index, file in enumerate(segments):
        cap = cv2.VideoCapture(str(file))
        expected = round(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        encoder = None
        count = 0
        with tempfile.TemporaryFile() as errors:
            try:
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    height, width = frame.shape[:2]
                    if not encoder:
                        encoder = subprocess.Popen([request['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                            '-f', 'rawvideo', '-pixel_format', 'bgr24', '-video_size', f'{width}x{height}', '-framerate', '24', '-i', 'pipe:0',
                            '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                            str(stage / f'pose-{index:05d}.mp4')], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
                    canvas = np.zeros_like(frame)
                    bboxes = model.det_model(frame)
                    if options['personCount']:
                        areas = np.prod(np.maximum(0, bboxes[:, 2:4] - bboxes[:, :2]), axis=1)
                        pairs = []
                        for track, previous in enumerate(tracked):
                            if previous is None or not len(bboxes): continue
                            overlap = np.prod(np.maximum(0, np.minimum(bboxes[:, 2:4], previous[2:4]) - np.maximum(bboxes[:, :2], previous[:2])), axis=1)
                            union = areas + np.prod(previous[2:4] - previous[:2]) - overlap
                            pairs.extend((float(score), track, candidate) for candidate, score in enumerate(overlap / np.maximum(union, 1)) if score >= 0.1)
                        matched, used = {}, set()
                        for _, track, candidate in sorted(pairs, reverse=True):
                            if track not in matched and candidate not in used:
                                matched[track] = candidate; used.add(candidate)
                        chosen = []
                        for track in range(len(tracked)):
                            candidate = matched.get(track)
                            if candidate is None and tracked[track] is None:
                                candidate = next((int(value) for value in np.argsort(-areas) if value not in used), None)
                            if candidate is None:
                                missing[track] += 1
                                if missing[track] >= 24: tracked[track] = None
                            else:
                                missing[track] = 0; tracked[track] = bboxes[candidate].copy()
                                chosen.append(candidate); used.add(candidate)
                        bboxes = bboxes[chosen]
                    max_people = max(max_people, len(bboxes))
                    if len(bboxes):
                        keypoints, scores = model.pose_model(frame, bboxes=bboxes)
                        if np.any(np.sum(scores[:, :18] > threshold, axis=1) >= 4):
                            detected += 1
                        canvas = draw_skeleton(canvas, keypoints, scores, openpose_skeleton=True, kpt_thr=threshold, radius=2, line_width=3)
                    encoder.stdin.write(canvas.tobytes())
                    count += 1
                    frames += 1
                    if count == 1 or count % 12 == 0:
                        emit(progress=f'pose batch {index + 1} of {len(segments)} · frame {count} of {expected}')
                if not count or count != expected:
                    raise ValueError('The saved video could not be decoded completely. Retry from a readable video.')
                encoder.stdin.close()
                if encoder.wait(timeout=30):
                    raise ValueError('The pose video could not be encoded.')
            finally:
                cap.release()
                if encoder and encoder.poll() is None:
                    encoder.kill()
                    encoder.wait()
    if not detected:
        raise ValueError('No clear human pose was found. Try a video with a visible person; no pose pin was saved.')
    return {'frames': frames, 'detectedFrames': detected, 'maxPeople': max_people, 'poseOptions': options, 'backend': 'DWPose / ONNX Runtime CPU'}


if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.read(1024 * 1024))
        emit(ok=True, result=extract(request))
    except Exception as error:
        emit(ok=False, error=str(error))
        sys.exit(1)
