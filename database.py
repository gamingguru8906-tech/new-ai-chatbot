"""
database.py - persistent sessions, chat history, credit cycles, and ledgers.

DATABASE_URL chooses the backend:
  - unset/blank        -> local SQLite file for testing
  - postgresql://...   -> cloud Postgres, including Supabase/Neon
"""

import datetime as dt
import json
import os
import random
import uuid

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
    delete,
    insert,
    select,
    text,
    update as sa_update,
)

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///veshannastro.db"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

FREE_WINDOW_HOURS = int(os.getenv("FREE_WINDOW_HOURS", "24"))
DEFAULT_CREDITS = int(os.getenv("FREE_CREDITS", "300"))

_engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
_meta = MetaData()

sessions = Table(
    "sessions",
    _meta,
    Column("session_id", String(64), primary_key=True),
    Column("stage", String(16), default="name"),
    Column("name", String(120)),
    Column("dob", String(20)),
    Column("tob", String(10)),
    Column("place", String(200)),
    Column("email", String(200)),
    Column("phone", String(40)),
    Column("chart_summary", Text),
    Column("chart_visual", Text),
    Column("history", Text, default="[]"),
    Column("free_used", Integer, default=0),
    Column("free_window_start", DateTime),
    Column("paid_credits", Integer, default=0),
    Column("is_lead", Integer, default=0),
    Column("total_paid", Float, default=0),
    Column("created_at", DateTime, default=dt.datetime.utcnow),
    Column("last_seen", DateTime, default=dt.datetime.utcnow),
)

credit_cycles = Table(
    "credit_cycles",
    _meta,
    Column("cycle_id", String(64), primary_key=True),
    Column("session_id", String(64), index=True),
    Column("kind", String(16), default="free"),  # free / paid
    Column("status", String(16), default="active"),  # active / depleted / expired / superseded
    Column("starting_credits", Integer, default=300),
    Column("credits_remaining", Integer, default=300),
    Column("deductions", Text, default="[]"),
    Column("deduction_index", Integer, default=0),
    Column("created_at", DateTime, default=dt.datetime.utcnow),
    Column("expires_at", DateTime),
    Column("amount_paid", Float, default=0),
    Column("razorpay_order_id", String(100)),
    Column("razorpay_payment_id", String(100)),
    UniqueConstraint("razorpay_payment_id", name="uq_credit_cycles_payment_id"),
)

credit_ledger = Table(
    "credit_ledger",
    _meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String(64), index=True),
    Column("cycle_id", String(64), index=True),
    Column("response_id", String(96), index=True),
    Column("credits_before", Integer),
    Column("credits_deducted", Integer),
    Column("credits_after", Integer),
    Column("created_at", DateTime, default=dt.datetime.utcnow),
    UniqueConstraint("response_id", name="uq_credit_ledger_response_id"),
)

assistant_responses = Table(
    "assistant_responses",
    _meta,
    Column("response_id", String(96), primary_key=True),
    Column("session_id", String(64), index=True),
    Column("cycle_id", String(64)),
    Column("user_message", Text),
    Column("assistant_reply", Text),
    Column("credits_before", Integer),
    Column("credits_deducted", Integer),
    Column("credits_after", Integer),
    Column("status", String(16), default="pending"),
    Column("created_at", DateTime, default=dt.datetime.utcnow),
    Column("completed_at", DateTime),
)

bracelet_leads = Table(
    "bracelet_leads",
    _meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("session_id", String(64)),
    Column("name", String(120)),
    Column("dob", String(20)),
    Column("tob", String(20)),
    Column("place", String(200)),
    Column("phone", String(40)),
    Column("recommendation_result", Text),
    Column("created_at", DateTime, default=dt.datetime.utcnow),
)


def init_db():
    _meta.create_all(_engine)
    _ensure_legacy_columns()


def _ensure_legacy_columns():
    """SQLite/Postgres-safe additive migrations for older deployed DBs."""
    statements = [
        "ALTER TABLE sessions ADD COLUMN free_window_start TIMESTAMP",
        "ALTER TABLE sessions ADD COLUMN chart_visual TEXT",
    ]
    with _engine.begin() as c:
        for statement in statements:
            try:
                c.execute(text(statement))
            except Exception:
                pass


def _rowdict(row):
    return dict(row) if row is not None else None


def _parse_dt(value):
    if isinstance(value, str):
        try:
            return dt.datetime.fromisoformat(value)
        except Exception:
            return None
    return value


def _get_or_create_in_conn(c, session_id):
    row = c.execute(
        select(sessions).where(sessions.c.session_id == session_id)
    ).mappings().first()
    if row is None:
        c.execute(insert(sessions).values(session_id=session_id))
        row = c.execute(
            select(sessions).where(sessions.c.session_id == session_id)
        ).mappings().first()
    return dict(row)


def get_or_create(session_id):
    with _engine.begin() as c:
        return _get_or_create_in_conn(c, session_id)


def update(session_id, **fields):
    if not fields:
        return
    fields["last_seen"] = dt.datetime.utcnow()
    with _engine.begin() as c:
        c.execute(
            sa_update(sessions)
            .where(sessions.c.session_id == session_id)
            .values(**fields)
        )


def get_history(session_id):
    return json.loads(get_or_create(session_id)["history"] or "[]")


def append_history(session_id, role, content):
    history = get_history(session_id)
    history.append({"role": role, "content": content})
    update(session_id, history=json.dumps(history[-12:]))


def _generate_deductions(total=DEFAULT_CREDITS):
    """Three random-looking backend deductions whose sum is exactly total."""
    total = int(total)
    if total <= 3:
        return [1, 1, max(0, total - 2)]

    rng = random.SystemRandom()
    low = max(1, round(total * 0.26))
    high = max(low, round(total * 0.41))
    first = rng.randint(low, high)
    second_low = max(low, total - first - high)
    second_high = min(high, total - first - low)
    if second_low > second_high:
        second = max(1, (total - first) // 2)
    else:
        second = rng.randint(second_low, second_high)
    third = total - first - second
    deductions = [first, second, third]
    rng.shuffle(deductions)
    return deductions


def _insert_credit_cycle(
    c,
    session_id,
    kind,
    credits=DEFAULT_CREDITS,
    expires_at=None,
    amount_paid=0,
    razorpay_order_id=None,
    razorpay_payment_id=None,
):
    now = dt.datetime.utcnow()
    cycle_id = uuid.uuid4().hex
    deductions = _generate_deductions(credits)
    c.execute(
        insert(credit_cycles).values(
            cycle_id=cycle_id,
            session_id=session_id,
            kind=kind,
            status="active",
            starting_credits=credits,
            credits_remaining=credits,
            deductions=json.dumps(deductions),
            deduction_index=0,
            created_at=now,
            expires_at=expires_at,
            amount_paid=amount_paid,
            razorpay_order_id=razorpay_order_id,
            razorpay_payment_id=razorpay_payment_id,
        )
    )
    return dict(
        c.execute(
            select(credit_cycles).where(credit_cycles.c.cycle_id == cycle_id)
        ).mappings().first()
    )


def _deactivate_active_cycles(c, session_id, status="superseded"):
    c.execute(
        sa_update(credit_cycles)
        .where(
            credit_cycles.c.session_id == session_id,
            credit_cycles.c.status == "active",
        )
        .values(status=status)
    )


def _ensure_current_cycle(c, session_id, free_limit=DEFAULT_CREDITS):
    now = dt.datetime.utcnow()
    _get_or_create_in_conn(c, session_id)

    c.execute(
        sa_update(credit_cycles)
        .where(
            credit_cycles.c.session_id == session_id,
            credit_cycles.c.kind == "free",
            credit_cycles.c.status == "active",
            credit_cycles.c.expires_at.is_not(None),
            credit_cycles.c.expires_at <= now,
        )
        .values(status="expired", credits_remaining=0)
    )

    active = c.execute(
        select(credit_cycles)
        .where(
            credit_cycles.c.session_id == session_id,
            credit_cycles.c.status == "active",
            credit_cycles.c.credits_remaining > 0,
        )
        .order_by(credit_cycles.c.created_at.desc())
    ).mappings().first()
    if active:
        return dict(active)

    latest_free = c.execute(
        select(credit_cycles)
        .where(
            credit_cycles.c.session_id == session_id,
            credit_cycles.c.kind == "free",
        )
        .order_by(credit_cycles.c.created_at.desc())
    ).mappings().first()
    latest_free = _rowdict(latest_free)

    if latest_free is None or _parse_dt(latest_free.get("expires_at")) <= now:
        expires_at = now + dt.timedelta(hours=FREE_WINDOW_HOURS)
        cycle = _insert_credit_cycle(
            c,
            session_id,
            kind="free",
            credits=free_limit,
            expires_at=expires_at,
        )
        c.execute(
            sa_update(sessions)
            .where(sessions.c.session_id == session_id)
            .values(
                free_used=0,
                paid_credits=0,
                free_window_start=now,
                last_seen=now,
            )
        )
        return cycle

    return latest_free


def _cycle_payload(cycle):
    now = dt.datetime.utcnow()
    expires_at = _parse_dt(cycle.get("expires_at"))
    credits = max(0, int(cycle.get("credits_remaining") or 0))
    eta = 0
    if cycle.get("kind") == "free" and expires_at:
        eta = max(0, round(((expires_at - now).total_seconds()) / 3600))
    return {
        "cycle_id": cycle.get("cycle_id"),
        "cycle_kind": cycle.get("kind"),
        "cycle_status": cycle.get("status"),
        "credits": credits,
        "free_remaining": credits,
        "paid_credits": 0,
        "responses_used": int(cycle.get("deduction_index") or 0),
        "responses_left": max(0, 3 - int(cycle.get("deduction_index") or 0)),
        "renewal_eta_hours": eta,
    }


def credit_status(session_id, free_limit=DEFAULT_CREDITS):
    with _engine.begin() as c:
        cycle = _ensure_current_cycle(c, session_id, free_limit)
        return _cycle_payload(cycle)


def renewal_eta_hours(session_id):
    return credit_status(session_id).get("renewal_eta_hours", FREE_WINDOW_HOURS)


def reserve_response_credit(session_id, response_id, user_message, free_limit=DEFAULT_CREDITS):
    """Reserve exactly one backend deduction for an AI response.

    Reusing response_id returns the already completed answer without charging
    again, which protects refresh/retry abuse.
    """
    now = dt.datetime.utcnow()
    with _engine.begin() as c:
        _get_or_create_in_conn(c, session_id)
        existing = c.execute(
            select(assistant_responses).where(
                assistant_responses.c.response_id == response_id,
                assistant_responses.c.session_id == session_id,
            )
        ).mappings().first()
        if existing:
            existing = dict(existing)
            if existing.get("status") == "completed":
                return {"allowed": True, "cached": True, **existing}
            return {"allowed": False, "pending": True, "credits": 0}

        cycle = _ensure_current_cycle(c, session_id, free_limit)
        if cycle.get("status") != "active" or int(cycle.get("credits_remaining") or 0) <= 0:
            return {"allowed": False, "locked": True, **_cycle_payload(cycle)}

        deductions = json.loads(cycle.get("deductions") or "[]")
        index = int(cycle.get("deduction_index") or 0)
        before = int(cycle.get("credits_remaining") or 0)
        planned = deductions[index] if index < len(deductions) else before
        deducted = min(before, max(0, int(planned)))
        after = max(0, before - deducted)
        next_index = index + 1
        status = "depleted" if after <= 0 or next_index >= 3 else "active"
        if status == "depleted":
            after = 0

        c.execute(
            sa_update(credit_cycles)
            .where(credit_cycles.c.cycle_id == cycle["cycle_id"])
            .values(
                credits_remaining=after,
                deduction_index=next_index,
                status=status,
            )
        )
        c.execute(
            insert(credit_ledger).values(
                session_id=session_id,
                cycle_id=cycle["cycle_id"],
                response_id=response_id,
                credits_before=before,
                credits_deducted=deducted,
                credits_after=after,
                created_at=now,
            )
        )
        c.execute(
            insert(assistant_responses).values(
                response_id=response_id,
                session_id=session_id,
                cycle_id=cycle["cycle_id"],
                user_message=user_message,
                credits_before=before,
                credits_deducted=deducted,
                credits_after=after,
                status="pending",
                created_at=now,
            )
        )

        if cycle.get("kind") == "free":
            c.execute(
                sa_update(sessions)
                .where(sessions.c.session_id == session_id)
                .values(free_used=int(cycle.get("starting_credits") or free_limit) - after)
            )
        else:
            c.execute(
                sa_update(sessions)
                .where(sessions.c.session_id == session_id)
                .values(paid_credits=after)
            )

        return {
            "allowed": True,
            "cached": False,
            "response_id": response_id,
            "cycle_id": cycle["cycle_id"],
            "credits_before": before,
            "credits_deducted": deducted,
            "credits_after": after,
            "credits": after,
            "cycle_kind": cycle.get("kind"),
        }


def complete_response(response_id, assistant_reply):
    with _engine.begin() as c:
        c.execute(
            sa_update(assistant_responses)
            .where(assistant_responses.c.response_id == response_id)
            .values(
                assistant_reply=assistant_reply,
                status="completed",
                completed_at=dt.datetime.utcnow(),
            )
        )


def cancel_response_credit(response_id):
    """Undo a pending credit reservation when no AI answer was produced."""
    with _engine.begin() as c:
        existing = c.execute(
            select(assistant_responses).where(
                assistant_responses.c.response_id == response_id
            )
        ).mappings().first()
        if not existing:
            return {"cancelled": False, "reason": "missing_response"}
        existing = dict(existing)
        if existing.get("status") != "pending":
            return {"cancelled": False, "reason": "not_pending"}

        cycle = c.execute(
            select(credit_cycles).where(
                credit_cycles.c.cycle_id == existing.get("cycle_id")
            )
        ).mappings().first()
        if not cycle:
            c.execute(
                delete(credit_ledger).where(
                    credit_ledger.c.response_id == response_id
                )
            )
            c.execute(
                delete(assistant_responses).where(
                    assistant_responses.c.response_id == response_id
                )
            )
            return {"cancelled": True, "reason": "cycle_missing"}

        cycle = dict(cycle)
        deducted = max(0, int(existing.get("credits_deducted") or 0))
        current = max(0, int(cycle.get("credits_remaining") or 0))
        starting = max(0, int(cycle.get("starting_credits") or DEFAULT_CREDITS))
        restored = min(starting, current + deducted)
        restored_index = max(0, int(cycle.get("deduction_index") or 0) - 1)
        restored_status = "active" if restored > 0 else "depleted"

        c.execute(
            sa_update(credit_cycles)
            .where(credit_cycles.c.cycle_id == cycle["cycle_id"])
            .values(
                credits_remaining=restored,
                deduction_index=restored_index,
                status=restored_status,
            )
        )
        c.execute(
            delete(credit_ledger).where(credit_ledger.c.response_id == response_id)
        )
        c.execute(
            delete(assistant_responses).where(
                assistant_responses.c.response_id == response_id
            )
        )

        if cycle.get("kind") == "free":
            c.execute(
                sa_update(sessions)
                .where(sessions.c.session_id == existing["session_id"])
                .values(free_used=max(0, starting - restored))
            )
        else:
            c.execute(
                sa_update(sessions)
                .where(sessions.c.session_id == existing["session_id"])
                .values(paid_credits=restored)
            )

        return {
            "cancelled": True,
            "credits": restored,
            "credits_refunded": deducted,
            "cycle_id": cycle["cycle_id"],
        }


def create_paid_credit_cycle(
    session_id,
    amount_paid,
    credits_to_add=DEFAULT_CREDITS,
    razorpay_order_id=None,
    razorpay_payment_id=None,
):
    with _engine.begin() as c:
        _get_or_create_in_conn(c, session_id)
        if razorpay_payment_id:
            existing = c.execute(
                select(credit_cycles).where(
                    credit_cycles.c.razorpay_payment_id == razorpay_payment_id
                )
            ).mappings().first()
            if existing:
                return _cycle_payload(dict(existing))

        _deactivate_active_cycles(c, session_id, status="superseded")
        cycle = _insert_credit_cycle(
            c,
            session_id,
            kind="paid",
            credits=credits_to_add,
            amount_paid=amount_paid,
            razorpay_order_id=razorpay_order_id,
            razorpay_payment_id=razorpay_payment_id,
        )
        row = _get_or_create_in_conn(c, session_id)
        c.execute(
            sa_update(sessions)
            .where(sessions.c.session_id == session_id)
            .values(
                paid_credits=credits_to_add,
                total_paid=float(row.get("total_paid") or 0) + float(amount_paid or 0),
                is_lead=1,
                last_seen=dt.datetime.utcnow(),
            )
        )
        return _cycle_payload(cycle)


def credit_balance(session_id, amount_paid, credits_to_add=DEFAULT_CREDITS):
    return create_paid_credit_cycle(
        session_id,
        amount_paid,
        credits_to_add=credits_to_add,
    )


def consume_credits(session_id, free_limit):
    """Compatibility wrapper for older callers.

    New chat code uses reserve_response_credit() so every response has an
    idempotent ledger entry.
    """
    response_id = "legacy-" + uuid.uuid4().hex
    reserved = reserve_response_credit(session_id, response_id, "legacy", free_limit)
    if not reserved.get("allowed"):
        return False, 0, False
    return True, int(reserved["credits_after"]), reserved.get("cycle_kind") == "paid"


def sync_bracelet_lead_to_google_sheets(payload):
    """Placeholder for a future Google Sheets sync."""
    return False


def store_bracelet_lead(session_id, name, dob, tob, place, phone, recommendation_result):
    payload = {
        "session_id": session_id,
        "name": name,
        "dob": dob,
        "tob": tob,
        "place": place,
        "phone": phone,
        "recommendation_result": recommendation_result,
    }
    with _engine.begin() as c:
        c.execute(insert(bracelet_leads).values(**payload))
    if phone:
        update(session_id, phone=phone, is_lead=1)
    sync_bracelet_lead_to_google_sheets(payload)


def list_leads():
    with _engine.begin() as c:
        rows = c.execute(
            select(
                sessions.c.session_id,
                sessions.c.name,
                sessions.c.email,
                sessions.c.phone,
                sessions.c.place,
                sessions.c.total_paid,
                sessions.c.created_at,
            )
            .where(sessions.c.is_lead == 1)
            .order_by(sessions.c.created_at.desc())
        ).mappings().all()
        return [dict(r) for r in rows]


def list_bracelet_leads():
    with _engine.begin() as c:
        rows = c.execute(
            select(
                bracelet_leads.c.session_id,
                bracelet_leads.c.name,
                bracelet_leads.c.dob,
                bracelet_leads.c.tob,
                bracelet_leads.c.place,
                bracelet_leads.c.phone,
                bracelet_leads.c.recommendation_result,
                bracelet_leads.c.created_at,
            )
            .order_by(bracelet_leads.c.created_at.desc())
        ).mappings().all()
        return [dict(r) for r in rows]


def ping():
    with _engine.begin() as c:
        c.execute(select(1))
