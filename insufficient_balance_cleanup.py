"""
آلية رفض تثبيت طلب المنزل عند عدم كفاية رصيد الكابتن.

الضوابط:
- العمولة الإجمالية = 16% من قيمة الرحلة: 12% للكابتن الأول + 4% للشركة.
- حذف جميع رسائل «تم» الخاصة بالكابتن نفسه والمرتبطة بالرحلة.
- يدعم الرد المقتبس وغير المقتبس والرسائل المتكررة.
- لا يحذف رسالة الطلب الأصلية أو رسائل كباتن آخرين.
- لا ينفذ أي تسوية مالية.
- لا يرسل رسالة إلى القروب؛ يرسل إشعارًا خاصًا للكابتن فقط.
- يمنع التكرار بمفتاح idempotency محفوظ في قاعدة البيانات.

هذا الملف يحتاج إلى Adapter يربط delete_message/send_private_message مع مكتبة
WhatsApp المستخدمة في النظام الفعلي.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable, Protocol


TOTAL_COMMISSION_BPS = 1_600  # 16.00%
PRODUCER_COMMISSION_BPS = 1_200  # 12.00%
COMPANY_COMMISSION_BPS = 400  # 4.00%


class WhatsAppAdapter(Protocol):
    def delete_message(self, message_id: str) -> None:
        """احذف رسالة واحدة من القروب الرسمي فقط."""

    def send_private_message(self, captain_phone: str, text: str) -> None:
        """أرسل رسالة خاصة للكابتن، وليس إلى القروب."""


@dataclass(frozen=True)
class CleanupResult:
    status: str
    order_id: int
    order_no: str
    required_fee_cents: int
    balance_cents: int
    deleted_message_ids: tuple[str, ...]
    skipped_message_ids: tuple[str, ...]


def money_to_cents(value: Decimal | int | float | str) -> int:
    """حوّل قيمة الدينار إلى قروش بأمان، مع التقريب إلى أقرب قرش."""
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int(amount * 100)


def required_commission_cents(fare_cents: int) -> int:
    """احسب عمولة طلب المنزل بنسبة 16% باستخدام أعداد صحيحة."""
    if fare_cents < 0:
        raise ValueError("fare_cents must be non-negative")
    return (fare_cents * TOTAL_COMMISSION_BPS + 5_000) // 10_000


def is_done_message(body: str) -> bool:
    """تعرّف رسائل تم مع مسافات وعلامات ترقيم بسيطة."""
    normalized = " ".join(str(body or "").strip().split())
    return normalized in {"تم", "تم.", "تم!", "تم جاهز", "تم جاهز الآن"}


def ensure_schema(db: sqlite3.Connection) -> None:
    """أنشئ جدول الحماية إن لم يكن موجودًا؛ لا يغيّر أرصدة المستخدمين."""
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS insufficient_balance_cleanup (
            idempotency_key TEXT PRIMARY KEY,
            order_id INTEGER NOT NULL,
            captain_id INTEGER NOT NULL,
            required_fee_cents INTEGER NOT NULL,
            balance_cents INTEGER NOT NULL,
            deleted_message_ids TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    db.commit()


def _message_is_linked_to_order(message: sqlite3.Row, order: sqlite3.Row) -> bool:
    """اربط الرسالة بالرحلة عبر الاقتباس أو ربط message_order_id المحفوظ."""
    if message["order_id"] is not None and int(message["order_id"]) == int(order["id"]):
        return True
    if message["quoted_message_id"] and message["quoted_message_id"] == order["source_message_id"]:
        return True
    return bool(message["source_message_id"] and message["source_message_id"] == order["source_message_id"])


def cleanup_insufficient_balance(
    db: sqlite3.Connection,
    whatsapp: WhatsAppAdapter,
    *,
    order_id: int,
    captain_id: int,
    idempotency_key: str | None = None,
) -> CleanupResult:
    """تحقق من الرصيد واحذف رسائل «تم» المرتبطة بالطلب عند عدم الكفاية.

    متطلبات الجداول:
      orders(id, order_no, fare_cents, source_message_id, group_id, status)
      users(id, phone, wallet_cents, active)
      messages(id, message_id, order_id, group_id, sender_user_id,
               quoted_message_id, body, deleted_at)
    """
    db.row_factory = sqlite3.Row
    ensure_schema(db)

    order = db.execute(
        """
        SELECT id, order_no, fare_cents, source_message_id, group_id, status
        FROM orders
        WHERE id = ?
        LIMIT 1
        """,
        (order_id,),
    ).fetchone()
    if not order:
        raise LookupError(f"order {order_id} not found")

    captain = db.execute(
        "SELECT id, phone, wallet_cents, active FROM users WHERE id=? LIMIT 1",
        (captain_id,),
    ).fetchone()
    if not captain:
        raise LookupError(f"captain {captain_id} not found")
    if not captain["active"]:
        return CleanupResult("captain_inactive", order_id, str(order["order_no"]), 0, int(captain["wallet_cents"]), (), ())

    required = required_commission_cents(int(order["fare_cents"]))
    balance = int(captain["wallet_cents"])
    if balance >= required:
        return CleanupResult("sufficient_balance", order_id, str(order["order_no"]), required, balance, (), ())

    key = idempotency_key or f"INSUFFICIENT-HOME-{order_id}-CAPTAIN-{captain_id}"
    existing = db.execute(
        "SELECT deleted_message_ids FROM insufficient_balance_cleanup WHERE idempotency_key=?",
        (key,),
    ).fetchone()
    if existing:
        deleted = tuple(filter(None, str(existing["deleted_message_ids"]).split(",")))
        return CleanupResult("already_processed", order_id, str(order["order_no"]), required, balance, deleted, ())

    # SELECT before deletion: message belongs to this captain, group, and exact order.
    candidates = db.execute(
        """
        SELECT id, message_id, order_id, group_id, sender_user_id,
               quoted_message_id, source_message_id, body
        FROM messages
        WHERE group_id = ?
          AND sender_user_id = ?
          AND deleted_at IS NULL
          AND (order_id = ? OR quoted_message_id = ? OR source_message_id = ?)
        ORDER BY id ASC
        """,
        (order["group_id"], captain_id, order_id, order["source_message_id"], order["source_message_id"]),
    ).fetchall()

    deleted: list[str] = []
    skipped: list[str] = []
    for message in candidates:
        # دفاع إضافي: لا نحذف إلا رسالة تم، ولا نثق بالـ SQL وحده.
        if not is_done_message(message["body"]) or not _message_is_linked_to_order(message, order):
            skipped.append(str(message["message_id"]))
            continue
        try:
            whatsapp.delete_message(str(message["message_id"]))
        except Exception:
            skipped.append(str(message["message_id"]))
            continue
        deleted.append(str(message["message_id"]))

    now = datetime.now(timezone.utc).isoformat()
    with db:
        db.executemany(
            "UPDATE messages SET deleted_at=? WHERE message_id=? AND sender_user_id=? AND deleted_at IS NULL",
            [(now, message_id, captain_id) for message_id in deleted],
        )
        db.execute(
            """
            INSERT INTO insufficient_balance_cleanup
              (idempotency_key, order_id, captain_id, required_fee_cents,
               balance_cents, deleted_message_ids, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (key, order_id, captain_id, required, balance, ",".join(deleted), now),
        )

    # لا تستخدم رقم القروب هنا؛ هذه الدالة مخصصة للإشعار الخاص فقط.
    if deleted:
        whatsapp.send_private_message(
            str(captain["phone"]),
            f"تم إلغاء الرحلة رقم {order['order_no']} فقط لعدم كفاية الرصيد.",
        )

    return CleanupResult(
        "rejected_insufficient_balance",
        order_id,
        str(order["order_no"]),
        required,
        balance,
        tuple(deleted),
        tuple(skipped),
    )


__all__ = [
    "CleanupResult",
    "COMPANY_COMMISSION_BPS",
    "PRODUCER_COMMISSION_BPS",
    "TOTAL_COMMISSION_BPS",
    "cleanup_insufficient_balance",
    "ensure_schema",
    "is_done_message",
    "money_to_cents",
    "required_commission_cents",
]
