import json
from queue import Empty, Queue
from threading import Lock
from typing import Generator

_subscribers: set[Queue[str]] = set()
_subscribers_lock = Lock()


def publish_admin_event(event_type: str, payload: dict | None = None) -> None:
    message = json.dumps({"type": event_type, "payload": payload or {}}, ensure_ascii=False)
    with _subscribers_lock:
        subscribers = list(_subscribers)
    for queue in subscribers:
        try:
            queue.put_nowait(message)
        except Exception:
            continue


def stream_admin_events() -> Generator[str, None, None]:
    queue: Queue[str] = Queue()
    with _subscribers_lock:
        _subscribers.add(queue)

    try:
        yield "event: admin_update\ndata: {\"type\":\"connected\",\"payload\":{}}\n\n"
        while True:
            try:
                message = queue.get(timeout=15)
                yield f"event: admin_update\ndata: {message}\n\n"
            except Empty:
                yield "event: ping\ndata: {}\n\n"
    finally:
        with _subscribers_lock:
            _subscribers.discard(queue)
