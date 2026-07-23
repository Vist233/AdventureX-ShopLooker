#!/usr/bin/env python3
"""Open a real StepFun streaming-ASR session without storing or sending audio."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import subprocess
import urllib.request
import uuid

import websockets


def synthesize_test_pcm(api_key: str) -> bytes:
    """Create a short, non-sensitive test utterance and decode it in memory."""
    payload = json.dumps({
        "model": "stepaudio-2.5-tts",
        "input": "这家店一个月营业额大约十二万元。",
        "voice": "cixingnansheng",
        "response_format": "mp3",
        "speed": 1,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        "https://api.stepfun.com/step_plan/v1/audio/speech",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        audio = response.read()
    decoded = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1",
        ],
        input=audio,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return decoded.stdout


async def main() -> None:
    api_key = os.environ.get("STEPFUN_API_KEY") or os.environ.get("step_API_KEY")
    if not api_key:
        raise RuntimeError("请先设置 STEPFUN_API_KEY 或 step_API_KEY")
    async with websockets.connect(
        "wss://api.stepfun.com/v1/realtime/asr/stream",
        extra_headers={"Authorization": f"Bearer {api_key}"},
        open_timeout=15,
        close_timeout=5,
    ) as socket:
        first = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
        if first.get("type") != "session.created":
            raise RuntimeError(f"没有收到 session.created：{first.get('type')}")
        await socket.send(json.dumps({
            "event_id": f"event_{uuid.uuid4().hex}",
            "type": "session.update",
            "session": {
                "audio": {
                    "input": {
                        "format": {
                            "type": "pcm",
                            "codec": "pcm_s16le",
                            "rate": 16000,
                            "bits": 16,
                            "channel": 1,
                        },
                        "transcription": {
                            "model": "stepaudio-2.5-asr-stream",
                            "language": "zh",
                            "full_rerun_on_commit": True,
                            "enable_itn": True,
                        },
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "silence_duration_ms": 600,
                        },
                    }
                }
            },
        }, ensure_ascii=False))
        updated = json.loads(await asyncio.wait_for(socket.recv(), timeout=15))
        if updated.get("type") != "session.updated":
            raise RuntimeError(f"没有收到 session.updated：{updated.get('type')}")

        pcm = await asyncio.to_thread(synthesize_test_pcm, api_key)
        # 20 ms of 16 kHz mono PCM16 is 640 bytes. Pace the stream so server VAD
        # sees a realistic session, then append 0.8 seconds of silence. That is
        # enough to cross the 600 ms demo threshold without adding a long tail.
        for offset in range(0, len(pcm), 640):
            chunk = pcm[offset:offset + 640]
            await socket.send(json.dumps({
                "event_id": f"event_{uuid.uuid4().hex}",
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(chunk).decode("ascii"),
            }))
            await asyncio.sleep(0.02)
        for _ in range(40):
            await socket.send(json.dumps({
                "event_id": f"event_{uuid.uuid4().hex}",
                "type": "input_audio_buffer.append",
                "audio": base64.b64encode(bytes(640)).decode("ascii"),
            }))
            await asyncio.sleep(0.02)

        transcript = ""
        deadline = asyncio.get_running_loop().time() + 25
        while asyncio.get_running_loop().time() < deadline:
            event = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
            if event.get("type") == "error":
                raise RuntimeError(f"StepFun ASR错误：{event.get('error', {}).get('message', 'unknown')}")
            if event.get("type") == "conversation.item.input_audio_transcription.completed":
                transcript = str(event.get("transcript") or "").strip()
                break
        if not transcript:
            raise RuntimeError("StepFun ASR没有返回最终转写")
        if not any(term in transcript for term in ("营业额", "十二万", "12万")):
            raise RuntimeError(f"StepFun ASR转写与测试语句明显不符：{transcript}")
        print(f"StepFun live ASR: authenticated, streamed PCM and transcribed {transcript!r}")


if __name__ == "__main__":
    asyncio.run(main())
