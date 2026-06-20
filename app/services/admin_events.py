import json
from queue import Empty, Queue
from threading import Lock
from typing import Generator

_subscribers_by_admin: dict[int, set[Queue[str]]] = {}
_subscribers_lock = Lock()


def publish_admin_event(
    event_type: str,
    payload: dict | None = None,
    *,
    admin_ids: list[int] | None = None,
) -> None:
    message = json.dumps({"type": event_type, "payload": payload or {}}, ensure_ascii=False)
    with _subscribers_lock:
        if admin_ids is None:
            queues = [queue for subscriber_set in _subscribers_by_admin.values() for queue in subscriber_set]
        else:
            queues = []
            for admin_id in admin_ids:
                queues.extend(_subscribers_by_admin.get(admin_id, ()))

    for queue in queues:
        try:
            queue.put_nowait(message)
        except Exception:
            continue


def stream_admin_events(admin_id: int) -> Generator[str, None, None]:
    queue: Queue[str] = Queue()
    with _subscribers_lock:
        _subscribers_by_admin.setdefault(admin_id, set()).add(queue)

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
            subscriber_set = _subscribers_by_admin.get(admin_id)
            if subscriber_set is not None:
                subscriber_set.discard(queue)
                if not subscriber_set:
                    del _subscribers_by_admin[admin_id]
