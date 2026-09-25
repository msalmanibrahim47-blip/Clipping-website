#!/usr/bin/env python3
"""Transcribe one audio chunk with faster-whisper and print word timings as JSON.

Usage: transcribe.py FILE [--model large-v3] [--language hi] [--prompt "..."] [--device cuda]
Output (last stdout line): {"language": "hi", "words": [{"s": 0.0, "e": 0.4, "w": "Guys", "c": 0.93}]}
"""
import argparse
import json
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--language", default=None)
    parser.add_argument("--prompt", default=None)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--compute-type", default="default")
    args = parser.parse_args()

    from faster_whisper import WhisperModel  # imported lazily so --help works without it

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.file,
        language=args.language,
        initial_prompt=args.prompt,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        condition_on_previous_text=False,
        beam_size=5,
    )
    words = []
    for segment in segments:
        for w in segment.words or []:
            text = w.word.strip()
            if text:
                words.append({"s": round(w.start, 3), "e": round(w.end, 3), "w": text, "c": round(w.probability, 3)})
    sys.stdout.write(json.dumps({"language": info.language, "words": words}, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
