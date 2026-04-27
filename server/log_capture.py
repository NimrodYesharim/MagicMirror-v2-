import sys
import logging
from collections import deque
from datetime import datetime

_buffer: deque = deque(maxlen=500)


class _StreamCapture:
    def __init__(self, original, level: str):
        self._orig = original
        self._level = level
        self._pending = ""

    def write(self, text: str):
        self._orig.write(text)
        self._pending += text
        while "\n" in self._pending:
            line, self._pending = self._pending.split("\n", 1)
            line = line.strip()
            if line:
                _buffer.append({
                    "time": datetime.now().strftime("%H:%M:%S"),
                    "level": self._level,
                    "msg": line,
                })

    def flush(self):
        self._orig.flush()

    def fileno(self):
        return self._orig.fileno()

    def isatty(self):
        return False


class _LogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        try:
            _buffer.append({
                "time": datetime.fromtimestamp(record.created).strftime("%H:%M:%S"),
                "level": record.levelname,
                "msg": self.format(record),
            })
        except Exception:
            pass


def setup():
    sys.stdout = _StreamCapture(sys.stdout, "INFO")
    sys.stderr = _StreamCapture(sys.stderr, "ERROR")

    handler = _LogHandler()
    handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))
    handler.setLevel(logging.WARNING)
    for name in ("uvicorn.error", "fastapi"):
        logging.getLogger(name).addHandler(handler)


def get_log_buffer() -> list:
    return list(_buffer)
