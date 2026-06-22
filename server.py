"""
server.py - Veshannastro on-site AI astrologer backend.

The browser stores only a stable session_id. Birth details, chart summary,
credit cycles, response ledger, and payment verification all live server-side.
"""

import hashlib
import hmac
import importlib.util
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import ai
import astrology
import database as db

load_dotenv()

FREE_LIMIT = int(os.getenv("FREE_CREDITS", "300"))
PRICE_PER_PACKAGE = int(os.getenv("PRICE_PER_PACKAGE_INR", "99"))
ADMIN_KEY = os.getenv("ADMIN_KEY", "change-me")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "https://veshannastro.co.in,https://www.veshannastro.co.in,http://localhost:8000",
    ).split(",")
    if origin.strip()
]

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "rzp_live_T0NA0F3UpQiZxl")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

FULL_CONSULTATION_URL = os.getenv(
    "FULL_CONSULTATION_URL",
    os.getenv("BOOKING_URL", "https://veshannastro.co.in"),
)
ONE_QUESTION_URL = os.getenv(
    "ONE_QUESTION_URL",
    os.getenv("BOOKING_URL", "https://veshannastro.co.in"),
)

HERE = os.path.dirname(os.path.abspath(__file__))
PLACE_SEARCH_CACHE = {}
PLACE_SEARCH_LAST_CALL = 0.0
PLACE_TIMEZONE_FINDER = None
PLACE_SEARCH_USER_AGENT = os.getenv(
    "PLACE_SEARCH_USER_AGENT",
    "VeshannastroAI/1.0 (https://veshannastro.co.in)",
)

app = FastAPI(title="Veshannastro Chat")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
db.init_db()


def _mount_gemstone_recommendation():
    path = os.path.join(HERE, "gemstone-recommendation", "api.py")
    if not os.path.exists(path):
        return
    spec = importlib.util.spec_from_file_location("gemstone_recommendation_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app.include_router(module.router)


_mount_gemstone_recommendation()

try:
    from credits_payments import router as maya_credits_router

    app.include_router(maya_credits_router)
except Exception as exc:
    print(f"[maya-credits] payment router not mounted: {exc}")


class StartReq(BaseModel):
    session_id: str


class MessageReq(BaseModel):
    session_id: str
    message: str
    client_message_id: Optional[str] = None


class OrderReq(BaseModel):
    session_id: str


class VerifyReq(BaseModel):
    session_id: str
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str


class SetupReq(BaseModel):
    session_id: str
    name: str
    dob: str
    tob: str = "12:00"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: Optional[str] = None
    place: str


class GemstoneReq(BaseModel):
    session_id: Optional[str] = None
    name: str
    whatsapp: Optional[str] = None
    dob: str
    tob: str = "12:00"
    birth_city: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: Optional[str] = None
    goal: Optional[str] = None


def _reply(text, **extra):
    return {"reply": text, **extra}


def _response_id(session_id: str, client_message_id: Optional[str]) -> str:
    raw = f"{session_id}:{client_message_id}" if client_message_id else f"{session_id}:{uuid.uuid4().hex}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _payment_button():
    return {"label": "Get 300 Credits (Rs. 99)", "action": "pay_credits"}


def _locked_credit_reply(session_id: str):
    status = db.credit_status(session_id, FREE_LIMIT)
    return _reply(
        "Your 300 credits are used. Recharge for \u20b999 to continue chatting with AI Astrologer.",
        stage="ready",
        locked=True,
        credits=0,
        free_remaining=0,
        renewal_eta_hours=status.get("renewal_eta_hours", 0),
        credit_status=status,
        buttons=[_payment_button()],
    )


BRACELET_BY_PLANET = {
    "Sun": {"product_id": "citrine-tiger-eye", "name": "Citrine + Tiger Eye Bracelet", "why": "Surya support confidence, vitality aur personal authority ko steady karta hai."},
    "Moon": {"product_id": "rose-quartz-moonstone", "name": "Rose Quartz + Moonstone Bracelet", "why": "Chandra support emotional calm, sensitivity aur inner balance ke liye diya gaya hai."},
    "Mars": {"product_id": "red-jasper-tiger-eye", "name": "Red Jasper + Tiger Eye Bracelet", "why": "Mangal support courage, stamina aur controlled action ko ground karta hai."},
    "Mercury": {"product_id": "green-aventurine-lapis-lazuli", "name": "Green Aventurine + Lapis Lazuli Bracelet", "why": "Budh support communication, study, business clarity aur decision-making ke liye hai."},
    "Jupiter": {"product_id": "citrine-yellow-aventurine", "name": "Citrine + Yellow Aventurine Bracelet", "why": "Guru support wisdom, growth, guidance aur dharmic expansion ko strengthen karta hai."},
    "Venus": {"product_id": "rose-quartz-green-aventurine", "name": "Rose Quartz + Green Aventurine Bracelet", "why": "Shukra support love, harmony, comfort aur heart-healing themes ke liye hai."},
    "Saturn": {"product_id": "black-tourmaline-blue-sapphire-substitute", "name": "Black Tourmaline + Blue Sapphire Substitute Bracelet", "why": "Shani support discipline, grounding, patience aur pressure protection ke liye diya gaya hai."},
    "Rahu": {"product_id": "triple-protection-amethyst", "name": "Triple Protection + Amethyst Bracelet", "why": "Rahu support mental noise, obsession, nazar/protection aur aura cleansing ke liye hai."},
    "Ketu": {"product_id": "amethyst-clear-quartz", "name": "Amethyst + Clear Quartz Bracelet", "why": "Ketu support detachment, intuition, spiritual clarity aur grounding ke liye hai."},
}


GOAL_PLANETS = {
    "career_wealth": ["Saturn", "Mercury", "Jupiter"],
    "love_relationships": ["Venus", "Moon", "Jupiter"],
    "protection_grounding": ["Rahu", "Saturn", "Ketu"],
    "health_energy": ["Sun", "Moon", "Mars"],
    "spiritual_growth": ["Ketu", "Jupiter", "Moon"],
}


PLANET_REMEDIES = {
    "Sun": "Final remedy: Roz subah Surya ko jal arpan karein aur 11 baar 'Om Suryaya Namah' bolen.",
    "Moon": "Final remedy: Somvaar ko doodh ya chawal donate karein aur 11 baar 'Om Som Somaya Namah' bolen.",
    "Mars": "Final remedy: Mangalvaar ko Hanuman ji ke saamne deepak jalakar 11 baar 'Om Angarakaya Namah' bolen.",
    "Mercury": "Final remedy: Budhvaar ko hara moong donate karein aur 11 baar 'Om Budhaya Namah' bolen.",
    "Jupiter": "Final remedy: Guruvaar ko haldi/chana dal donate karein aur 11 baar 'Om Gurave Namah' bolen.",
    "Venus": "Final remedy: Shukravaar ko white sweets ya kapda donate karein aur 11 baar 'Om Shukraya Namah' bolen.",
    "Saturn": "Final remedy: Shanivaar ko black sesame donate karein aur 108 baar 'Om Sham Shanicharaya Namah' bolen.",
    "Rahu": "Final remedy: Shanivaar ko Durga Maa ko yaad karke 108 baar 'Om Raahave Namah' bolen aur black sesame donate karein.",
    "Ketu": "Final remedy: Mangalvaar ko Ganesh ji ko durva chadhayein aur 108 baar 'Om Ketave Namah' bolen.",
}


def _birth_chart_from_gemstone_req(req: GemstoneReq):
    place = req.birth_city.strip()
    if req.latitude is not None and req.longitude is not None:
        tz = req.timezone
        if not tz:
            from timezonefinder import TimezoneFinder

            tz = TimezoneFinder().timezone_at(lat=req.latitude, lng=req.longitude) or "UTC"
        return astrology.calculate_chart_from_coords(req.dob, req.tob, req.latitude, req.longitude, tz, place)
    return astrology.calculate_chart(req.dob, req.tob, place)


def _planet_chart_context(chart, planet_name: str) -> str:
    planet = next((p for p in chart.planets if p.name == planet_name), None)
    if not planet:
        return f"{planet_name} placement available nahi hai."
    dignity = ""
    try:
        sign_idx = astrology.SIGNS.index(planet.sign)
        dig = astrology._dignity(planet.name, sign_idx)
        dignity = f", dignity: {dig}" if dig else ""
    except Exception:
        pass
    retro = ", retrograde" if getattr(planet, "retrograde", False) else ""
    if planet_name in ("Rahu", "Ketu"):
        return f"{planet_name} H{planet.house} mein {planet.sign} mein hai{retro}; karmic axis activate hoti hai."
    lords = chart.house_lords_map()
    ruled = [str(h) for h, lord in lords.items() if lord == planet_name]
    lordship = f"rules H{','.join(ruled)}; " if ruled else ""
    return f"{planet_name} {lordship}sits H{planet.house} mein {planet.sign}{dignity}{retro}."


def _current_transit_notes(chart) -> list[str]:
    try:
        moon_idx = astrology.SIGNS.index(chart.moon_sign)
        notes = astrology._current_transits(chart.ascendant_sign_index, moon_idx, chart.planets)
        return [n for n in notes if n.startswith(("Jupiter", "Saturn", "Rahu"))][:4]
    except Exception:
        return []


def _bracelet_card(planet_name: str, role: str, chart, details, transit_notes: list[str]):
    product = BRACELET_BY_PLANET.get(planet_name) or BRACELET_BY_PLANET["Rahu"]
    if role == "Antardasha":
        period = f"{details['antar_start'].strftime('%d %b %Y')} to {details['antar_end'].strftime('%d %b %Y')}"
    elif role == "Mahadasha":
        period = f"{details['maha_start'].strftime('%d %b %Y')} to {details['maha_end'].strftime('%d %b %Y')}"
    else:
        period = f"{details['pratyantar_start'].strftime('%d %b %Y')} to {details['pratyantar_end'].strftime('%d %b %Y')}"
    gochar = " ".join(transit_notes[:2]) if transit_notes else "Current Gochar support Dasha activation ke saath read kiya gaya."
    return {
        "product_id": product["product_id"],
        "name": product["name"],
        "why": product["why"],
        "planetary_reason": product["why"],
        "dasha_gochar_reason": f"{role} lord {planet_name} active hai. {_planet_chart_context(chart, planet_name)} Gochar check: {gochar}",
        "best_period": period,
        "wearing_instruction": "Right/receiving wrist par subah sankalp ke saath pehnen. Isse spiritual support maana jaye, guaranteed result nahi.",
        "price": "Contact for price",
        "product_url": f"/bracelets?ref=maya&id={product['product_id']}",
    }


def _build_bracelet_recommendations(chart, goal: Optional[str]):
    details = astrology._vimshottari_details(chart)
    transit_notes = _current_transit_notes(chart)
    ordered_planets = [details["antar"], details["maha"], details["pratyantar"]]
    ordered_planets += GOAL_PLANETS.get(goal or "", [])
    if "Saturn" not in ordered_planets:
        ordered_planets.append("Saturn")
    selected = []
    for planet in ordered_planets:
        if planet in BRACELET_BY_PLANET and planet not in selected:
            selected.append(planet)
        if len(selected) == 3:
            break
    roles = ["Antardasha", "Mahadasha", "Pratyantardasha/Goal"]
    cards = [_bracelet_card(planet, roles[i], chart, details, transit_notes) for i, planet in enumerate(selected)]
    remedy_planet = details["antar"] if details["antar"] in PLANET_REMEDIES else details["maha"]
    return {
        "message": (
            f"Current timing {details['maha']} Mahadasha / {details['antar']} Antardasha / "
            f"{details['pratyantar']} Pratyantardasha activate kar raha hai. "
            "Bracelet suggestions Dasha, Gochar aur chart placement ko combine karke diye gaye hain."
        ),
        "current_dasha": {
            "mahadasha": details["maha"],
            "antardasha": details["antar"],
            "pratyantardasha": details["pratyantar"],
            "mahadasha_end": details["maha_end"].isoformat(),
            "antardasha_end": details["antar_end"].isoformat(),
            "pratyantardasha_end": details["pratyantar_end"].isoformat(),
        },
        "transit_notes": transit_notes,
        "recommendations": cards,
        "final_remedy": PLANET_REMEDIES.get(remedy_planet, PLANET_REMEDIES["Saturn"]),
        "disclaimer": "Gemstone bracelets aur remedies spiritual support hain; medical, legal, financial ya guaranteed result ka replacement nahi.",
    }


def _chart_visual_from_row(row):
    if not row.get("chart_visual"):
        return None
    try:
        return json.loads(row["chart_visual"])
    except Exception:
        return None


def _cta_buttons():
    return [
        {"label": "Book a Full Consultation", "url": FULL_CONSULTATION_URL},
        {"label": "Ask One Question (Call)", "url": ONE_QUESTION_URL},
    ]


def _place_timezone(lat: float, lon: float) -> str:
    global PLACE_TIMEZONE_FINDER
    try:
        from timezonefinder import TimezoneFinder

        if PLACE_TIMEZONE_FINDER is None:
            PLACE_TIMEZONE_FINDER = TimezoneFinder()
        return PLACE_TIMEZONE_FINDER.timezone_at(lat=lat, lng=lon) or "UTC"
    except Exception:
        return "UTC"


def _place_label(*parts) -> str:
    seen = set()
    clean = []
    for part in parts:
        value = " ".join(str(part or "").strip().split())
        if not value:
            continue
        key = value.lower()
        if key not in seen:
            clean.append(value)
            seen.add(key)
    return ", ".join(clean)


def _dedupe_places(results: list[dict]) -> list[dict]:
    unique = []
    seen = set()
    for item in results:
        key = (round(float(item["lat"]), 4), round(float(item["lon"]), 4), item["label"].lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:10]


def _nominatim_places(query: str) -> list[dict]:
    params = urllib.parse.urlencode(
        {
            "format": "jsonv2",
            "q": query,
            "limit": 10,
            "addressdetails": 1,
            "accept-language": "en",
        }
    )
    request = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"User-Agent": PLACE_SEARCH_USER_AGENT, "Referer": "https://veshannastro.co.in"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = json.loads(response.read().decode("utf-8"))

    results = []
    for item in raw:
        try:
            lat = float(item["lat"])
            lon = float(item["lon"])
        except Exception:
            continue
        address = item.get("address") or {}
        primary = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or address.get("county")
            or item.get("name")
            or query
        )
        label = item.get("display_name") or _place_label(primary, address.get("state"), address.get("country"))
        results.append(
            {
                "name": primary,
                "label": label,
                "state": address.get("state") or "",
                "country": address.get("country") or "",
                "lat": lat,
                "lon": lon,
                "tz": _place_timezone(lat, lon),
                "source": "openstreetmap",
            }
        )
    return _dedupe_places(results)


def _photon_places(query: str) -> list[dict]:
    params = urllib.parse.urlencode({"q": query, "limit": 10, "lang": "en"})
    request = urllib.request.Request(
        f"https://photon.komoot.io/api/?{params}",
        headers={"User-Agent": PLACE_SEARCH_USER_AGENT, "Referer": "https://veshannastro.co.in"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = json.loads(response.read().decode("utf-8"))

    results = []
    for feature in raw.get("features", []):
        props = feature.get("properties") or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        try:
            lon = float(coords[0])
            lat = float(coords[1])
        except Exception:
            continue
        primary = props.get("city") or props.get("name") or props.get("county") or query
        state = props.get("state") or ""
        country = props.get("country") or ""
        label = _place_label(props.get("name"), props.get("city"), state, country) or query
        results.append(
            {
                "name": primary,
                "label": label,
                "state": state,
                "country": country,
                "lat": lat,
                "lon": lon,
                "tz": _place_timezone(lat, lon),
                "source": "photon",
            }
        )
    return _dedupe_places(results)


@app.get("/api/places")
def places(q: str = ""):
    """User-triggered global place search using free providers.

    Nominatim is tried first; Photon is a backup so the UI does not die when
    one free endpoint is slow or temporarily blocked.
    """
    global PLACE_SEARCH_LAST_CALL
    query = " ".join((q or "").strip().split())
    if len(query) < 3:
        return {"ok": True, "places": [], "attribution": "OpenStreetMap contributors"}

    key = query.lower()
    cached = PLACE_SEARCH_CACHE.get(key)
    if cached:
        return cached

    elapsed = time.monotonic() - PLACE_SEARCH_LAST_CALL
    if elapsed < 0.45:
        time.sleep(0.45 - elapsed)
    PLACE_SEARCH_LAST_CALL = time.monotonic()

    errors = []
    places_result = []
    provider = ""
    for provider_name, searcher in (("openstreetmap", _nominatim_places), ("photon", _photon_places)):
        try:
            places_result = searcher(query)
            provider = provider_name
            if places_result:
                break
        except Exception as exc:
            errors.append(f"{provider_name}: {exc}")

    payload = {
        "ok": True,
        "places": places_result,
        "provider": provider,
        "attribution": "OpenStreetMap contributors, Photon/Komoot",
    }
    if errors and not places_result:
        payload["warning"] = "Place search is slow right now. Try city plus country, or try again."
    PLACE_SEARCH_CACHE[key] = payload
    return payload


@app.post("/api/start")
def start(req: StartReq):
    row = db.get_or_create(req.session_id)
    credit_status = db.credit_status(req.session_id, FREE_LIMIT)
    if row["stage"] == "ready":
        return _reply(
            f"Namaste {row['name']}, welcome back. Aap apna question pooch sakte hain.",
            stage="ready",
            show_form=False,
            credits=credit_status["credits"],
            free_remaining=credit_status["credits"],
            paid_credits=0,
            credit_status=credit_status,
            chart_data=_chart_visual_from_row(row),
        )

    return _reply(
        "Namaste, main Maya hoon. Birth details fill kijiye, phir main aapki Kundli dekhkar Hinglish mein jawab dungi. Aapko 300 free credits milte hain.",
        stage="setup",
        show_form=True,
        credits=credit_status["credits"],
        credit_status=credit_status,
    )


@app.post("/api/setup")
def setup(req: SetupReq):
    if not req.name.strip() or not req.dob.strip() or not req.place.strip():
        return _reply("Name, date of birth, birth time, aur birth city check karke dobara try kijiye.", ok=False)

    try:
        if req.latitude is not None and req.longitude is not None:
            tz = req.timezone
            if not tz:
                from timezonefinder import TimezoneFinder

                tz = TimezoneFinder().timezone_at(lat=req.latitude, lng=req.longitude) or "UTC"
            chart = astrology.calculate_chart_from_coords(
                req.dob,
                req.tob,
                req.latitude,
                req.longitude,
                tz,
                req.place,
            )
        else:
            chart = astrology.calculate_chart(req.dob, req.tob, req.place)
    except Exception as exc:
        return _reply(
            f"Main chart calculate nahi kar paayi ({exc}). Birth date, time aur city check karke try kijiye.",
            ok=False,
        )

    chart_visual = chart.chart_data()
    db.get_or_create(req.session_id)
    db.update(
        req.session_id,
        name=req.name.strip(),
        dob=req.dob.strip(),
        tob=req.tob.strip(),
        place=req.place.strip(),
        stage="ready",
        chart_summary=chart.full_summary(),
        chart_visual=json.dumps(chart_visual),
    )
    credit_status = db.credit_status(req.session_id, FREE_LIMIT)

    overview = chart.overview_block()
    try:
        validation = chart.validate()
        if validation["confidence"] != "high" and (validation["issues"] or validation["notes"]):
            caveat = " ".join(validation["issues"] + validation["notes"])
            overview += "\n\nAccuracy note: " + caveat
    except Exception:
        pass

    return _reply(
        "Yeh rahi aapki Kundli. Iske baad jo bhi jawab dungi, woh isi chart ke layers se aayega.",
        ok=True,
        stage="ready",
        credits=credit_status["credits"],
        free_remaining=credit_status["credits"],
        credit_status=credit_status,
        chart_data=chart_visual,
        overview=overview,
        ask_prompt="Ab apna specific question poochiye, jaise marriage, career, money, foreign travel, ya life direction. Agar full reading chahiye toh likhiye: Give me a full reading.",
    )


@app.post("/api/gemstone/recommend")
def gemstone_recommend(req: GemstoneReq):
    if not req.name.strip() or not req.dob.strip() or not req.birth_city.strip():
        return {"ok": False, "error": "Name, date of birth, time aur birth place required hai."}
    try:
        chart = _birth_chart_from_gemstone_req(req)
        result = _build_bracelet_recommendations(chart, req.goal)
        result["ok"] = True
        result["name"] = req.name.strip()
        return result
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Bracelet recommendation calculate nahi ho paayi: {exc}",
        }


@app.post("/api/message")
def message(req: MessageReq):
    row = db.get_or_create(req.session_id)
    text = req.message.strip()
    if not text:
        return _reply("Apna question likhiye, phir main chart ke hisaab se jawab dungi.", stage="ready")

    if row["stage"] != "ready" or not row["chart_summary"]:
        return _reply(
            "Pehle birth details setup karte hain, tabhi main accurate Kundli reading de paungi.",
            stage="setup",
            show_form=True,
        )

    status = db.credit_status(req.session_id, FREE_LIMIT)
    if status["credits"] <= 0:
        return _locked_credit_reply(req.session_id)

    response_id = _response_id(req.session_id, req.client_message_id)
    reserved = db.reserve_response_credit(req.session_id, response_id, text, FREE_LIMIT)

    if reserved.get("cached"):
        return _reply(
            reserved.get("assistant_reply") or "",
            stage="ready",
            locked=False,
            cached=True,
            response_id=response_id,
            credits=reserved.get("credits_after", 0),
            free_remaining=reserved.get("credits_after", 0),
            credits_before=reserved.get("credits_before", 0),
            credits_deducted=reserved.get("credits_deducted", 0),
            credits_after=reserved.get("credits_after", 0),
        )

    if reserved.get("pending"):
        raise HTTPException(409, "This question is already being processed.")

    if not reserved.get("allowed"):
        return _locked_credit_reply(req.session_id)

    reading = ai.generate_reading(row["chart_summary"], text, db.get_history(req.session_id))
    db.complete_response(response_id, reading)
    db.append_history(req.session_id, "user", text)
    db.append_history(req.session_id, "assistant", reading)

    credits_after = reserved["credits_after"]
    return _reply(
        reading,
        stage="ready",
        locked=False,
        response_id=response_id,
        credits=credits_after,
        free_remaining=credits_after,
        credits_before=reserved["credits_before"],
        credits_deducted=reserved["credits_deducted"],
        credits_after=credits_after,
        cycle_id=reserved["cycle_id"],
        requires_recharge=credits_after <= 0,
        buttons=[_payment_button()] if credits_after <= 0 else [],
    )


@app.post("/api/create-order")
def create_order(req: OrderReq):
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
        raise HTTPException(500, "Razorpay keys not configured on server.")
    import razorpay

    client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    order = client.order.create(
        {
            "amount": PRICE_PER_PACKAGE * 100,
            "currency": "INR",
            "notes": {"session_id": req.session_id, "product": "astro_credits"},
        }
    )
    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
        "price_inr": PRICE_PER_PACKAGE,
    }


@app.post("/api/verify-payment")
def verify_payment(req: VerifyReq):
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
        raise HTTPException(500, "Razorpay keys not configured on server.")

    body = f"{req.razorpay_order_id}|{req.razorpay_payment_id}"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        body.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, req.razorpay_signature):
        raise HTTPException(400, "Payment verification failed.")

    status = db.create_paid_credit_cycle(
        req.session_id,
        PRICE_PER_PACKAGE,
        credits_to_add=300,
        razorpay_order_id=req.razorpay_order_id,
        razorpay_payment_id=req.razorpay_payment_id,
    )
    return {
        "ok": True,
        "message": "Payment verified. 300 credits added.",
        "credits": status["credits"],
        "credits_after": status["credits"],
        "credit_status": status,
    }


@app.get("/api/leads")
def leads(x_admin_key: str = Header(default="")):
    if not hmac.compare_digest(x_admin_key, ADMIN_KEY):
        raise HTTPException(403, "Forbidden")
    return {"leads": db.list_leads()}


@app.get("/widget.js")
def widget_js():
    return FileResponse(os.path.join(HERE, "widget.js"), media_type="application/javascript")


@app.get("/")
def demo():
    return FileResponse(os.path.join(HERE, "demo.html"))


@app.get("/healthz")
def healthz():
    try:
        db.ping()
        return {"ok": True}
    except Exception:
        return {"ok": False}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
