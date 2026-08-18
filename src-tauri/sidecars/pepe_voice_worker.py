from __future__ import annotations

import argparse
import base64
import contextlib
import hashlib
import io
import json
import os
import re
import sys
import wave
from pathlib import Path

import numpy as np


def normalize_for_offline_synthesis(text: str) -> str:
    """Maps reviewed names and rejects Latin text that needs online assets."""
    normalized = re.sub(
        r"(?<![A-Za-z])Dr\.\s*Stardust(?![A-Za-z])",
        "博士",
        text,
        flags=re.IGNORECASE,
    )
    if re.search(r"[A-Za-z]", normalized):
        raise ValueError("Unregistered Latin text is unavailable in the offline voice runtime")
    return normalized


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> None:
    # Rust's JSON Lines protocol is always UTF-8. Windows otherwise decodes a
    # redirected Python stdin with the active legacy code page, silently
    # turning Chinese request text into mojibake before synthesis.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--package-dir", required=True, type=Path)
    parser.add_argument("--engine-dir", required=True, type=Path)
    args = parser.parse_args()

    package = args.package_dir.resolve()
    engine = args.engine_dir.resolve()
    profile = json.loads((package / "voice_profile.json").read_text(encoding="utf-8"))
    reference = (package / profile["reference"]["path"]).resolve()
    if sha256(reference) != profile["reference"]["sha256"]:
        raise RuntimeError("Reference audio checksum mismatch")

    weights = (package / "weights" / "pretrained_models").resolve()
    g2pw = engine / "GPT_SoVITS" / "text" / "G2PWModel"
    if not g2pw.is_dir():
        raise RuntimeError("G2PWModel is missing from the configured engine directory")

    os.chdir(engine)
    sys.path.insert(0, str(engine))
    sys.path.insert(0, str(engine / "GPT_SoVITS"))
    # Third-party engine diagnostics must use stderr: stdout is reserved for
    # the machine-readable protocol and may contain synthesized audio base64.
    with contextlib.redirect_stdout(sys.stderr):
        from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config

        config = {
            "version": "v2",
            "custom": {
                "device": "cuda",
                "is_half": True,
                "version": "v2",
                "t2s_weights_path": str(weights / "s1v3.ckpt"),
                "vits_weights_path": str(weights / "v2Pro" / "s2Gv2ProPlus.pth"),
                "cnhuhbert_base_path": str(weights / "chinese-hubert-base"),
                "bert_base_path": str(weights / "chinese-roberta-wwm-ext-large"),
            },
        }
        pipeline = TTS(TTS_Config(config))

    emit({
        "type": "ready",
        "characterId": profile["character_id"],
        "voiceIdentity": "pepe.zh-CN.cn_012",
    })

    for line in sys.stdin:
        message: dict = {}
        try:
            message = json.loads(line)
            if message.get("type") == "shutdown":
                emit({"type": "shutdown-complete"})
                return
            if message.get("type") != "synthesize":
                raise ValueError("Unsupported worker message")
            request_id = str(message["requestId"])
            text = str(message["text"]).strip()
            seed = int(message.get("seed", 2026081501))
            if not text or len(text) > 256:
                raise ValueError("Text must contain 1-256 characters")
            synthesis_text = normalize_for_offline_synthesis(text)
            request = {
                "text": synthesis_text,
                "text_lang": "all_zh",
                "ref_audio_path": str(reference),
                "aux_ref_audio_paths": [],
                "prompt_text": profile["reference"]["canonical_transcript"],
                "prompt_lang": "all_zh",
                "top_k": 5,
                "top_p": 1.0,
                "temperature": 1.0,
                "text_split_method": "cut5",
                "batch_size": 1,
                "batch_threshold": 0.75,
                "split_bucket": True,
                "return_fragment": False,
                "speed_factor": 1.0,
                "fragment_interval": 0.3,
                "seed": seed,
                "parallel_infer": True,
                "repetition_penalty": 1.35,
                "sample_steps": 32,
                "super_sampling": False,
            }
            # GPT-SoVITS prints the requested text to stdout. Suppress that
            # output so application diagnostics never persist user content.
            with contextlib.redirect_stdout(io.StringIO()):
                chunks = list(pipeline.run(request))
            if len(chunks) != 1:
                raise RuntimeError(f"Expected one output, received {len(chunks)}")
            sample_rate, audio = chunks[0]
            audio = np.asarray(audio)
            if audio.dtype != np.int16 or audio.ndim != 1 or not np.any(audio):
                raise RuntimeError("Engine returned invalid or silent audio")
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(sample_rate)
                output.writeframes(audio.tobytes())
            wav_bytes = buffer.getvalue()
            emit({
                "type": "synthesis-complete",
                "requestId": request_id,
                "sampleRate": sample_rate,
                "durationSeconds": round(len(audio) / sample_rate, 4),
                "audioSha256": hashlib.sha256(wav_bytes).hexdigest(),
                "audioBase64": base64.b64encode(wav_bytes).decode("ascii"),
            })
        except Exception as error:
            emit({
                "type": "error",
                "requestId": message.get("requestId") if isinstance(message, dict) else None,
                "error": f"{type(error).__name__}: {error}",
            })


if __name__ == "__main__":
    main()
