"""작업 정산 상태를 DB에서 확인합니다.

사용 예:
  $env:DATABASE_URL="mysql://..."; python scripts/check_job_settlement.py J-NJN6MN6EHS
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select, text

from app.db import get_engine
from app.models.admin_models import Job, JobStatusLog, Settlement, SettlementItem


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python scripts/check_job_settlement.py <job_id>", file=sys.stderr)
        return 1

    job_id = sys.argv[1].strip()
    engine = get_engine()
    if engine is None:
        print("DATABASE_URL is not configured.", file=sys.stderr)
        return 1

    with engine.connect() as conn:
        tables = {
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT TABLE_NAME
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME IN ('jobs', 'job_status_logs', 'settlements', 'settlement_items')
                    """
                )
            )
        }
        print("tables:", ", ".join(sorted(tables)) or "(none)")

    from sqlalchemy.orm import Session

    with Session(engine) as db:
        job = db.scalar(select(Job).where(Job.job_id == job_id))
        if job is None:
            print(f"job not found: {job_id}")
            return 1

        print(f"job_id: {job.job_id}")
        print(f"status: {job.status}")
        print(f"assigned_transcriber_id: {job.assigned_transcriber_id}")
        print(f"duration_seconds: {job.duration_seconds}")
        print(f"settlement_amount: {job.settlement_amount}")
        print(f"settlement_status: {job.settlement_status}")
        print(f"completed_at: {job.completed_at}")
        print(f"final_pdf_generated_at: {job.final_pdf_generated_at}")
        print(f"final_pdf_r2_key: {bool(job.final_pdf_r2_key)}")

        logs = db.scalars(
            select(JobStatusLog)
            .where(JobStatusLog.job_id == job_id, JobStatusLog.to_status == "pdf_sent")
            .order_by(JobStatusLog.changed_at.desc())
        ).all()
        print(f"pdf_sent logs: {len(logs)}")
        for log in logs:
            print(f"  - changed_at={log.changed_at} note={log.change_note!r}")

        items = db.scalars(select(SettlementItem).where(SettlementItem.job_id == job_id)).all()
        print(f"settlement_items: {len(items)}")
        for item in items:
            settlement = db.scalar(select(Settlement).where(Settlement.id == item.settlement_id))
            period = ""
            if settlement is not None:
                period = f"{settlement.period_start} ~ {settlement.period_end}"
            print(
                f"  - item_id={item.id} settlement_id={item.settlement_id} "
                f"amount={item.amount} minutes={item.quantity_minutes} period={period}"
            )

        if job.status == "pdf_sent" and not items:
            print()
            print("진단: pdf_sent 이지만 settlement_items 가 없습니다.")
            if not logs:
                print("  원인 후보: job_status_logs 에 pdf_sent 기록 없음")
            if job.assigned_transcriber_id is None:
                print("  원인 후보: assigned_transcriber_id 없음")
            print("  복구: 배포 후 POST /api/jobs/admin/jobs/{job_id}/sync-settlement 호출")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
