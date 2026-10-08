"""Optional pose-runtime checks: deterministic people/joints, real skeleton drawing."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import cv2
import numpy as np


spec = importlib.util.spec_from_file_location('pose_worker', Path(__file__).resolve().parents[1] / 'worker/pose.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class PoseWorkerTests(unittest.TestCase):
    def run_frames(self, count=0, confidence=0.3, missing=False):
        selected, canvases = [], []
        with tempfile.TemporaryDirectory() as temporary:
            stage = Path(temporary)
            segments = [stage / f'source-{index:05d}.mp4' for index in range(2)]
            models = [stage / 'det.onnx', stage / 'pose.onnx']
            for file in [*segments, *models]: file.touch()

            class Capture:
                def __init__(self, file): self.index = 0; self.offset = int(Path(file).stem[-5:]) * 2
                def get(self, _): return 2
                def release(self): pass
                def read(self):
                    if self.index == 2: return False, None
                    frame = np.zeros((120, 240, 3), np.uint8)
                    frame[0, 0, 0] = self.offset + self.index
                    self.index += 1
                    return True, frame

            def detection(frame):
                index = int(frame[0, 0, 0])
                a, b = [10 + index, 10, 70 + index, 100], [110 + index, 10, 160 + index, 90]
                c = [190, 10, 210, 40] if index == 0 else [170, 0, 239, 115]
                if missing and index == 1: return np.array([c], dtype=float)
                return np.array([a, b, c] if index == 0 else [c, b, a], dtype=float)

            def inference(frame, bboxes):
                selected.append(bboxes.copy())
                keypoints = np.zeros((len(bboxes), 134, 2), dtype=float)
                for person, box in enumerate(bboxes):
                    for joint in range(134): keypoints[person, joint] = [box[0] + joint % 10 * 3, box[1] + joint // 10 * 5]
                scores = np.full((len(bboxes), 134), 0.4)
                scores[:, :4] = 0.95
                return keypoints, scores

            def encoder(*args, **kwargs):
                process = Mock()
                process.stdin.write.side_effect = lambda data: canvases.append(np.frombuffer(data, np.uint8).copy())
                process.wait.return_value = process.poll.return_value = 0
                return process

            model = Mock(det_model=detection, pose_model=inference)
            request = {'stage': str(stage), 'segments': list(map(str, segments)), 'models': list(map(str, models)),
                       'ffmpeg': 'fixture encoder', 'options': {'personCount': count, 'jointConfidence': confidence}}
            output = io.StringIO()
            with patch('rtmlib.Wholebody', return_value=model), patch('cv2.VideoCapture', Capture), patch('subprocess.Popen', encoder), patch('sys.stdout', output):
                result = worker.extract(request)
            self.progress = [json.loads(line)['progress'] for line in output.getvalue().splitlines()]
        return result, selected, canvases

    def test_one_person_stays_on_the_initial_subject_when_background_grows_and_batches_change(self):
        result, selected, canvases = self.run_frames(count=1)
        self.assertEqual(result['frames'], 4)
        self.assertEqual(result['maxPeople'], 1)
        self.assertEqual(len(canvases), 4)
        self.assertEqual([float(boxes[0, 0]) for boxes in selected], [10, 11, 12, 13])
        self.assertIn('pose batch 1 of 2 · frame 1 of 2', self.progress)
        self.assertIn('pose batch 2 of 2 · frame 1 of 2', self.progress)

    def test_two_people_are_distinct_and_background_people_are_excluded(self):
        result, selected, _ = self.run_frames(count=2)
        self.assertEqual(result['maxPeople'], 2)
        self.assertEqual([sorted(boxes[:, 0].tolist()) for boxes in selected], [[10, 110], [11, 111], [12, 112], [13, 113]])

    def test_all_keeps_every_detection_and_higher_confidence_removes_uncertain_drawn_joints(self):
        all_result, all_people, _ = self.run_frames()
        self.assertEqual(all_result['maxPeople'], 3)
        self.assertTrue(all(len(boxes) == 3 for boxes in all_people))
        _, _, low = self.run_frames(count=1, confidence=0.3)
        _, _, high = self.run_frames(count=1, confidence=0.7)
        self.assertGreater(sum(np.count_nonzero(frame) for frame in low), sum(np.count_nonzero(frame) for frame in high))

    def test_lost_subject_does_not_immediately_jump_to_an_extra_person_or_drop_frames(self):
        result, selected, canvases = self.run_frames(count=1, missing=True)
        self.assertEqual(result['frames'], 4)
        self.assertEqual(len(canvases), 4)
        self.assertEqual(np.count_nonzero(canvases[1]), 0)
        self.assertEqual([float(boxes[0, 0]) for boxes in selected], [10, 12, 13])

    def test_invalid_cleanup_options_are_rejected_before_loading_models(self):
        for count, confidence in [(True, 0.3), (-1, 0.3), (11, 0.3), (1, float('nan')), (1, 1)]:
            with self.subTest(count=count, confidence=confidence), patch('rtmlib.Wholebody') as model:
                with self.assertRaisesRegex(ValueError, 'Invalid pose cleanup settings'):
                    worker.extract({'stage': '.', 'segments': [], 'models': [], 'options': {'personCount': count, 'jointConfidence': confidence}})
                model.assert_not_called()


if __name__ == '__main__':
    unittest.main()
