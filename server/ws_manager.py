import json
from fastapi import WebSocket


class WSManager:
    def __init__(self):
        self._connections: list[WebSocket] = []
        self._state_providers = {}

    def register_state_provider(self, msg_type: str, provider_func):
        self._state_providers[msg_type] = provider_func

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.append(ws)
        # Send initial states from all registered providers
        for msg_type, provider in self._state_providers.items():
            state = provider()
            if state is not None:
                await ws.send_json({"type": msg_type, "data": state})

    def disconnect(self, ws: WebSocket):
        if ws in self._connections:
            self._connections.remove(ws)

    async def broadcast(self, message: dict):
        dead = []
        payload = json.dumps(message)
        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)
