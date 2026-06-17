"""
EEG Trigger Server
------------------
Mirrors the lab's existing send_trigger() pattern:
  - Serial pulse on COM3 @ 115200 baud  (primary → BioSemi Status channel)
  - LSL marker push                      (secondary → LabRecorder)

Run once before starting the Electron task:
    python trigger_server.py

Reads COM port and WS port from ../eeg-config.json if present,
otherwise falls back to defaults (COM3, port 8765).
"""

import asyncio
import json
import os
import sys
import serial
import websockets
from pylsl import StreamInfo, StreamOutlet

# ── Config ────────────────────────────────────────────────────────────────────

def load_config():
    cfg_path = os.path.join(os.path.dirname(__file__), '..', 'eeg-config.json')
    try:
        with open(cfg_path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

cfg = load_config()
SERIAL_PORT  = cfg.get('serialPort',   'COM3')
BAUD_RATE    = cfg.get('baudRate',      115200)
LSL_NAME     = cfg.get('lslStreamName', 'PsychoPy_LSL')
WS_PORT      = cfg.get('wsPort',        8765)

# ── Serial setup ──────────────────────────────────────────────────────────────

port = None
try:
    port = serial.Serial(SERIAL_PORT, BAUD_RATE)
    print(f'[EEG] Serial open: {SERIAL_PORT} @ {BAUD_RATE} baud')
except Exception as e:
    print(f'[EEG] Serial FAILED ({e}) — serial triggers disabled', file=sys.stderr)

# ── LSL setup ─────────────────────────────────────────────────────────────────

info = StreamInfo(
    name=LSL_NAME,
    type='Markers',
    channel_count=1,
    nominal_srate=0,
    channel_format='int32',
    source_id='psy_marker',
)
outlet = StreamOutlet(info)
print(f'[EEG] LSL outlet created: {LSL_NAME}')

# ── Trigger dispatch ───────────────────────────────────────────────────────────

async def send_trigger(code: int):
    # Serial
    if port is not None:
        try:
            port.write(bytes([code]))
            await asyncio.sleep(0.005)   # 5 ms pulse
            port.write(bytes([0]))
        except Exception as e:
            print(f'[EEG] Serial trigger failed: {e}', file=sys.stderr)

    # LSL
    try:
        outlet.push_sample([code])
    except Exception as e:
        print(f'[EEG] LSL trigger failed: {e}', file=sys.stderr)

    print(f'[EEG] Trigger sent: {code}')

# ── WebSocket server ───────────────────────────────────────────────────────────

async def handle(websocket):
    print(f'[EEG] Client connected: {websocket.remote_address}')
    try:
        async for message in websocket:
            try:
                code = int(message.strip())
                await send_trigger(code)
            except ValueError:
                print(f'[EEG] Bad message: {message!r}', file=sys.stderr)
    except websockets.exceptions.ConnectionClosed:
        pass
    print(f'[EEG] Client disconnected')

async def main():
    print(f'[EEG] Trigger server listening on ws://localhost:{WS_PORT}')
    async with websockets.serve(handle, 'localhost', WS_PORT):
        await asyncio.Future()   # run forever

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('\n[EEG] Server stopped.')
        if port:
            port.close()
