import argparse
from importlib.metadata import version
import json
import os
import re
import sys


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def normalized_text(segments):
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    return re.sub(r"\s+", " ", text).strip()


def transcribe(model, audio_path):
    if not isinstance(audio_path, str) or not os.path.isfile(audio_path):
        raise ValueError("The recorded audio file is unavailable.")
    segments, info = model.transcribe(
        audio_path,
        beam_size=1,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 250},
        word_timestamps=False,
    )
    return {
        "text": normalized_text(segments),
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
    }


def main():
    parser = argparse.ArgumentParser(description="CC Relay faster-whisper CPU worker")
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--model", default="base")
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--cpu-threads", type=int, default=4)
    args = parser.parse_args()
    if not args.worker:
        parser.error("--worker is required")

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, min(8, args.cpu_threads)),
        num_workers=1,
        download_root=args.cache_dir,
    )
    emit({"type": "ready", "engineVersion": version("faster-whisper"), "model": args.model})

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = str(request.get("id", ""))
            result = transcribe(model, request.get("audio"))
            emit({"type": "result", "id": request_id, **result})
        except Exception as error:
            emit({"type": "error", "id": request_id, "error": str(error)})


if __name__ == "__main__":
    main()
