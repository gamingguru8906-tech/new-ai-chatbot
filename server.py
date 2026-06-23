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

load_dotenv()

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import ai
import astrology
import database as db

ASTRO_ENGINE_VERSION = getattr(astrology, "ENGINE_VERSION", "unknown")
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
BRACELET_SHOP_URL = os.getenv("BRACELET_SHOP_URL", "https://veshannastro.co.in/")

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
    tob: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    timezone: Optional[str] = None
    place: str


class GemstoneReq(BaseModel):
    session_id: Optional[str] = None
    name: str
    whatsapp: Optional[str] = None
    dob: str
    tob: Optional[str] = None
    birth_city: str = ""
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


BRACELET_CATALOG = {
    "VA-BR-TP-001": {"name": "Triple Protection Bracelet", "mrp": 999, "price": 699, "discount": 30, "gemstones": "Tiger Eye + Black Obsidian + Hematite", "stock": "In Stock", "description": "A bold mixed-stone protection bracelet designed for daily wear and grounding.", "benefits": "Protection, grounding, confidence, negativity shielding", "tags": ["protection", "career", "strength", "grounding"]},
    "VA-BR-AM-002": {"name": "Amethyst Bracelet", "mrp": 899, "price": 599, "discount": 33, "gemstones": "Amethyst", "stock": "In Stock", "description": "A calming purple crystal bracelet for peace, clarity, and spiritual balance.", "benefits": "Calm mind, stress relief, intuition, spiritual growth", "tags": ["peace", "intuition", "spirituality", "healing"]},
    "VA-BR-CQ-003": {"name": "Clear Quartz Bracelet", "mrp": 799, "price": 549, "discount": 31, "gemstones": "Clear Quartz", "stock": "In Stock", "description": "A clean transparent crystal bracelet known as a universal energy amplifier.", "benefits": "Energy amplification, clarity, focus, cleansing", "tags": ["clarity", "focus", "healing", "energy"]},
    "VA-BR-BT-004": {"name": "Black Tourmaline Bracelet", "mrp": 899, "price": 649, "discount": 28, "gemstones": "Black Tourmaline", "stock": "In Stock", "description": "A deep black protection bracelet for grounding and energetic shielding.", "benefits": "Protection, grounding, negativity removal, stability", "tags": ["protection", "grounding", "negativity", "stability"]},
    "VA-BR-CT-005": {"name": "Citrine Bracelet", "mrp": 999, "price": 699, "discount": 30, "gemstones": "Citrine", "stock": "In Stock", "description": "A bright golden bracelet associated with abundance, confidence, and motivation.", "benefits": "Wealth, abundance, confidence, success mindset", "tags": ["wealth", "success", "confidence", "manifestation"]},
    "VA-BR-YA-006": {"name": "Yellow Aventurine Bracelet", "mrp": 799, "price": 499, "discount": 38, "gemstones": "Yellow Aventurine", "stock": "In Stock", "description": "A warm yellow bracelet for optimism, personal power, and positive action.", "benefits": "Confidence, optimism, willpower, decision-making", "tags": ["confidence", "positivity", "career", "motivation"]},
    "VA-BR-RJ-007": {"name": "Red Jasper Bracelet", "mrp": 799, "price": 499, "discount": 38, "gemstones": "Red Jasper", "stock": "In Stock", "description": "An earthy red bracelet for stamina, courage, and grounded strength.", "benefits": "Strength, stamina, courage, stability", "tags": ["health", "strength", "grounding", "courage"]},
    "VA-BR-TE-008": {"name": "Tiger Eye Bracelet", "mrp": 899, "price": 599, "discount": 33, "gemstones": "Tiger Eye", "stock": "In Stock", "description": "A glossy golden-brown bracelet for confidence, focus, and practical success.", "benefits": "Confidence, focus, courage, protection", "tags": ["career", "success", "protection", "confidence"]},
    "VA-BR-RQ-009": {"name": "Rose Quartz Bracelet", "mrp": 799, "price": 549, "discount": 31, "gemstones": "Rose Quartz", "stock": "In Stock", "description": "A soft pink bracelet for emotional healing, self-love, and harmony.", "benefits": "Love, emotional healing, self-love, relationship harmony", "tags": ["love", "relationships", "healing", "peace"]},
    "VA-BR-GA-010": {"name": "Green Aventurine Bracelet", "mrp": 799, "price": 499, "discount": 38, "gemstones": "Green Aventurine", "stock": "In Stock", "description": "A soothing green bracelet linked with luck, growth, and heart-centered balance.", "benefits": "Luck, growth, opportunity, heart balance", "tags": ["wealth", "luck", "growth", "heart"]},
    "VA-BR-LL-011": {"name": "Lapis Lazuli Bracelet", "mrp": 999, "price": 699, "discount": 30, "gemstones": "Lapis Lazuli", "stock": "In Stock", "description": "A royal blue bracelet for wisdom, communication, and inner truth.", "benefits": "Wisdom, communication, truth, self-awareness", "tags": ["wisdom", "communication", "study", "intuition"]},
    "VA-BR-MN-012": {"name": "Moonstone Bracelet", "mrp": 1099, "price": 749, "discount": 32, "gemstones": "White / Rainbow Moonstone", "stock": "In Stock", "description": "A gentle luminous bracelet associated with emotional balance and intuition.", "benefits": "Emotional balance, intuition, feminine energy, calmness", "tags": ["moon", "intuition", "peace", "emotional healing"]},
    "VA-BR-7C-013": {"name": "7 Chakra Bracelet", "mrp": 899, "price": 599, "discount": 33, "gemstones": "7 Chakra mixed gemstones", "stock": "In Stock", "description": "A multi-color chakra bracelet designed for energetic balance and alignment.", "benefits": "Chakra balance, energy alignment, positivity, overall wellness", "tags": ["chakra", "healing", "balance", "spirituality"]},
    "VA-BR-IO-014": {"name": "Iolite Bracelet", "mrp": 1099, "price": 799, "discount": 27, "gemstones": "Iolite", "stock": "In Stock", "description": "A deep blue-grey bracelet for intuition, vision, and inner direction.", "benefits": "Intuition, vision, inner guidance, mental clarity", "tags": ["intuition", "clarity", "spirituality", "focus"]},
}


BRACELET_BY_PLANET = {
    "Sun": {"sku": "VA-BR-CT-005", "why": "Surya support confidence, vitality aur personal authority ko steady karta hai."},
    "Moon": {"sku": "VA-BR-MN-012", "why": "Chandra support emotional calm, sensitivity aur inner balance ke liye diya gaya hai."},
    "Mars": {"sku": "VA-BR-RJ-007", "why": "Mangal support courage, stamina aur controlled action ko ground karta hai."},
    "Mercury": {"sku": "VA-BR-LL-011", "why": "Budh support communication, study, business clarity aur decision-making ke liye hai."},
    "Jupiter": {"sku": "VA-BR-YA-006", "why": "Guru support wisdom, growth, guidance aur dharmic expansion ko strengthen karta hai."},
    "Venus": {"sku": "VA-BR-RQ-009", "why": "Shukra support love, harmony, comfort aur heart-healing themes ke liye hai."},
    "Saturn": {"sku": "VA-BR-BT-004", "why": "Shani support discipline, grounding, patience aur pressure protection ke liye diya gaya hai."},
    "Rahu": {"sku": "VA-BR-TP-001", "why": "Rahu support mental noise, obsession, nazar/protection aur aura cleansing ke liye hai."},
    "Ketu": {"sku": "VA-BR-AM-002", "why": "Ketu support detachment, intuition, spiritual clarity aur grounding ke liye hai."},
}


GOAL_PLANETS = {
    "career_wealth": ["Saturn", "Mercury", "Jupiter"],
    "love_relationships": ["Venus", "Moon", "Jupiter"],
    "protection_grounding": ["Rahu", "Saturn", "Ketu"],
    "protection_clarity": ["Rahu", "Saturn", "Ketu"],
    "health_energy": ["Sun", "Moon", "Mars"],
    "spiritual_growth": ["Ketu", "Jupiter", "Moon"],
}

NUMEROLOGY_BRACELETS = {
    1: {"sku": "VA-BR-CT-005", "secondary_sku": "VA-BR-TE-008", "planet": "Sun", "focus": "confidence, leadership aur self-belief"},
    2: {"sku": "VA-BR-MN-012", "secondary_sku": "VA-BR-RQ-009", "planet": "Moon", "focus": "emotional balance, intuition aur calm response"},
    3: {"sku": "VA-BR-CT-005", "secondary_sku": "VA-BR-YA-006", "planet": "Jupiter", "focus": "growth, wisdom aur opportunity mindset"},
    4: {"sku": "VA-BR-TP-001", "secondary_sku": "VA-BR-AM-002", "planet": "Rahu", "focus": "protection, grounding aur scattered energy ko control"},
    5: {"sku": "VA-BR-GA-010", "secondary_sku": "VA-BR-LL-011", "planet": "Mercury", "focus": "communication, clarity aur smart decision-making"},
    6: {"sku": "VA-BR-RQ-009", "secondary_sku": "VA-BR-GA-010", "planet": "Venus", "focus": "love, harmony aur heart healing"},
    7: {"sku": "VA-BR-AM-002", "secondary_sku": "VA-BR-CQ-003", "planet": "Ketu", "focus": "intuition, spiritual clarity aur mental quiet"},
    8: {"sku": "VA-BR-BT-004", "secondary_sku": "VA-BR-IO-014", "planet": "Saturn", "focus": "discipline, protection aur pressure handling"},
    9: {"sku": "VA-BR-RJ-007", "secondary_sku": "VA-BR-TE-008", "planet": "Mars", "focus": "courage, stamina aur decisive action"},
}

PLANET_TO_NUMEROLOGY_NUMBER = {
    value["planet"]: key for key, value in NUMEROLOGY_BRACELETS.items()
}

SUN_SIGNS = [
    ((3, 21), (4, 19), "Aries", "Mesha", "Fire", "Mars"),
    ((4, 20), (5, 20), "Taurus", "Vrishabha", "Earth", "Venus"),
    ((5, 21), (6, 20), "Gemini", "Mithuna", "Air", "Mercury"),
    ((6, 21), (7, 22), "Cancer", "Karka", "Water", "Moon"),
    ((7, 23), (8, 22), "Leo", "Simha", "Fire", "Sun"),
    ((8, 23), (9, 22), "Virgo", "Kanya", "Earth", "Mercury"),
    ((9, 23), (10, 22), "Libra", "Tula", "Air", "Venus"),
    ((10, 23), (11, 21), "Scorpio", "Vrischika", "Water", "Mars"),
    ((11, 22), (12, 21), "Sagittarius", "Dhanu", "Fire", "Jupiter"),
    ((12, 22), (1, 19), "Capricorn", "Makara", "Earth", "Saturn"),
    ((1, 20), (2, 18), "Aquarius", "Kumbha", "Air", "Saturn"),
    ((2, 19), (3, 20), "Pisces", "Meena", "Water", "Jupiter"),
]

ELEMENT_SUPPORT = {
    "Fire": {"sku": "VA-BR-CQ-003", "why": "Fire sign energy ko cool, channel aur amplify karne ke liye Clear Quartz support diya gaya hai."},
    "Earth": {"sku": "VA-BR-GA-010", "why": "Earth sign energy ko grounded growth, abundance aur opportunity ke saath align karta hai."},
    "Air": {"sku": "VA-BR-LL-011", "why": "Air sign ke liye communication, mental clarity aur truthful expression ko sharpen karta hai."},
    "Water": {"sku": "VA-BR-RQ-009", "why": "Water sign emotional depth ko soothe karta hai aur intuition/love energy ko balance karta hai."},
}

GOAL_NUMBERS = {
    "career_wealth": [8, 5, 3],
    "love_relationships": [6, 2, 3],
    "protection_grounding": [4, 8, 7],
    "protection_clarity": [4, 8, 7],
    "health_energy": [9, 1, 2],
    "spiritual_growth": [7, 3, 2],
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


def _has_exact_birth_time(value: Optional[str]) -> bool:
    raw = str(value or "").strip().lower()
    if not raw or raw in {"unknown", "not sure", "dont know", "don't know", "na", "n/a"}:
        return False
    try:
        astrology._normalize_time(raw)
        return True
    except Exception:
        return False


def _reduce_number(value: int, keep_master: bool = False) -> int:
    while value > 9 and not (keep_master and value in (11, 22, 33)):
        value = sum(int(ch) for ch in str(value))
    return value


def _life_path_number(dob: str) -> int:
    year, month, day = astrology._normalize_date(dob)
    return _reduce_number(sum(int(ch) for ch in f"{year:04d}{month:02d}{day:02d}"))


def _birth_number(dob: str) -> int:
    _year, _month, day = astrology._normalize_date(dob)
    return _reduce_number(day)


def _date_in_range(month: int, day: int, start: tuple[int, int], end: tuple[int, int]) -> bool:
    md = (month, day)
    if start <= end:
        return start <= md <= end
    return md >= start or md <= end


def _sun_sign_info(dob: str) -> dict:
    _year, month, day = astrology._normalize_date(dob)
    for start, end, western, vedic, element, ruler in SUN_SIGNS:
        if _date_in_range(month, day, start, end):
            return {
                "western": western,
                "vedic": vedic,
                "element": element,
                "ruler": ruler,
                "number": PLANET_TO_NUMEROLOGY_NUMBER.get(ruler, 1),
            }
    return {
        "western": "Leo",
        "vedic": "Simha",
        "element": "Fire",
        "ruler": "Sun",
        "number": 1,
    }


def _name_number(name: str) -> int:
    total = 0
    for ch in name.upper():
        if "A" <= ch <= "Z":
            total += ((ord(ch) - ord("A")) % 9) + 1
    return _reduce_number(total or 1)


def _bracelet_product_card(
    sku: str,
    role: str,
    why: str,
    reason: str,
    best_period: str = "Next 45 to 90 days isko daily sankalp ke saath wear karna most practical support window hai.",
    wearing_instruction: str = "Subah pehli baar pehnein, 11 deep breaths ke saath clear sankalp rakhein. Spiritual support hai, guaranteed result nahi.",
):
    product = BRACELET_CATALOG[sku]
    return {
        "sku": sku,
        "product_id": sku,
        "name": product["name"],
        "gemstones": product["gemstones"],
        "description": product["description"],
        "benefits": product["benefits"],
        "tags": product["tags"],
        "stock": product["stock"],
        "why": why,
        "planetary_reason": why,
        "dasha_gochar_reason": reason,
        "best_period": best_period,
        "wearing_instruction": wearing_instruction,
        "mrp": product["mrp"],
        "price_value": product["price"],
        "discount": product["discount"],
        "price": f"Rs. {product['price']}",
        "image_url": _bracelet_image_url(sku),
        "product_url": _bracelet_checkout_url([sku]),
        "discount_note": "15% AI recommendation discount auto-applies in cart.",
        "role": role,
    }


def _numerology_card(num: int, role: str, reason: str):
    item = NUMEROLOGY_BRACELETS.get(num) or NUMEROLOGY_BRACELETS[4]
    sku = item["sku"]
    why = f"{role} number {num} {item['planet']} vibration se linked hai; isliye yeh bracelet {item['focus']} ke liye best match hai."
    return _bracelet_product_card(sku, role, why, reason)


def _build_numerology_bracelet_recommendations(req: GemstoneReq):
    birth = _birth_number(req.dob)
    life = _life_path_number(req.dob)
    sun = _sun_sign_info(req.dob)
    name_num = _name_number(req.name)

    signal_planets = [
        NUMEROLOGY_BRACELETS[birth]["planet"],
        NUMEROLOGY_BRACELETS[life]["planet"],
        sun["ruler"],
    ]
    counts = {planet: signal_planets.count(planet) for planet in signal_planets}
    dominant_planet = max(
        signal_planets,
        key=lambda planet: (counts[planet], planet == signal_planets[0], planet == signal_planets[1]),
    )
    dominant_number = PLANET_TO_NUMEROLOGY_NUMBER.get(dominant_planet, birth)
    if counts.get(dominant_planet, 0) < 2:
        dominant_number = birth
        dominant_planet = NUMEROLOGY_BRACELETS[birth]["planet"]

    primary_reason = (
        f"Birth Number {birth} ({NUMEROLOGY_BRACELETS[birth]['planet']}), "
        f"Life Path {life} ({NUMEROLOGY_BRACELETS[life]['planet']}), aur "
        f"Sun Sign {sun['western']} / {sun['vedic']} ({sun['element']}, ruler {sun['ruler']}) ko cross-check kiya. "
        f"Dominant support {dominant_planet} energy par aata hai. Birth time unknown hai, isliye Lagna/Dasha/Gochar claim nahi kiya gaya."
    )
    cards = [_numerology_card(dominant_number, "Primary DOB fallback", primary_reason)]

    element_support = ELEMENT_SUPPORT.get(sun["element"], ELEMENT_SUPPORT["Fire"])
    secondary_sku = element_support["sku"]
    secondary_role = f"{sun['element']} Sun Sign Support"
    secondary_why = element_support["why"]
    if secondary_sku == cards[0]["sku"]:
        fallback_item = NUMEROLOGY_BRACELETS.get(birth) or NUMEROLOGY_BRACELETS[life]
        secondary_sku = fallback_item.get("secondary_sku") or NUMEROLOGY_BRACELETS[life].get("secondary_sku")
        secondary_role = "Secondary Birth Number Support"
        secondary_why = (
            f"Birth Number {birth} ke secondary bracelet mapping se yeh support liya gaya, "
            "taaki primary bracelet ke saath balanced pairing ban sake."
        )
    secondary_reason = (
        f"Sun Sign {sun['western']} / {sun['vedic']} {sun['element']} element mein aata hai. "
        f"{secondary_why} Yeh second bracelet primary recommendation ko balance karta hai."
    )
    if secondary_sku and secondary_sku != cards[0]["sku"]:
        cards.append(_bracelet_product_card(secondary_sku, secondary_role, secondary_why, secondary_reason))
    elif life != dominant_number:
        cards.append(_numerology_card(life, "Life Path Support", primary_reason))

    recommended_skus = [card["sku"] for card in cards]
    primary = cards[0]
    return {
        "ok": True,
        "mode": "numerology_fallback",
        "message": (
            f"Birth time missing hai, isliye Maya ne Kundli/Dasha calculate nahi ki. "
            f"DOB se Birth Number {birth}, Life Path {life}, aur Sun Sign {sun['western']} / {sun['vedic']} nikla. "
            f"Final conclusion: {primary['name']} aapka strongest first bracelet hai."
        ),
        "numerology": {
            "birth_number": birth,
            "life_path": life,
            "name_number": name_num,
            "sun_sign": sun["western"],
            "vedic_sun_sign": sun["vedic"],
            "sun_element": sun["element"],
            "sun_ruler": sun["ruler"],
            "dominant_planet": dominant_planet,
            "method": "DOB fallback: birth date reduction + full DOB life path + date-range Sun sign. Name number is retained only as a tie-break/personalisation signal.",
        },
        "recommendations": cards,
        "recommended_skus": recommended_skus,
        "checkout_url": _bracelet_checkout_url(recommended_skus),
        "discount_note": "15% AI recommendation discount cart mein automatically apply hoga.",
        "final_remedy": "One Remedy: Bracelet pehne se pehle 11 deep breaths lein, phir 11 baar apna naam bolkar sankalp rakhein: 'Main apni energy ko stable, protected aur positive direction mein use kar raha/rahi hoon.'",
        "final_prediction": (
            f"Final conclusion: {primary['name']} primary support hai. Second bracelet pairing ke saath next 45-90 days mein "
            "emotional steadiness, clarity aur practical decision energy ko support milne ki strong possibility hai, especially daily sankalp ke saath."
        ),
        "disclaimer": "Birth time unknown hone par yeh Kundli/Dasha reading nahi hai; yeh DOB-based numerology + Sun sign spiritual bracelet guidance hai.",
    }


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


def _bracelet_image_url(sku: str) -> str:
    return f"https://veshannastro.co.in/images/bracelets/{sku}.webp"


def _bracelet_checkout_url(skus: list[str]) -> str:
    clean_skus = [sku for sku in skus if sku in BRACELET_CATALOG]
    base = (BRACELET_SHOP_URL or "https://veshannastro.co.in/").split("#", 1)[0]
    separator = "&" if "?" in base else "?"
    query = urllib.parse.urlencode({"maya_bundle": ",".join(clean_skus)})
    return f"{base}{separator}{query}#bracelet-shop"


def _bracelet_card(planet_name: str, role: str, chart, details, transit_notes: list[str]):
    product_ref = BRACELET_BY_PLANET.get(planet_name) or BRACELET_BY_PLANET["Rahu"]
    sku = product_ref["sku"]
    product = BRACELET_CATALOG[sku]
    if role == "Antardasha":
        period = f"{details['antar_start'].strftime('%d %b %Y')} to {details['antar_end'].strftime('%d %b %Y')}"
    elif role == "Mahadasha":
        period = f"{details['maha_start'].strftime('%d %b %Y')} to {details['maha_end'].strftime('%d %b %Y')}"
    else:
        period = f"{details['pratyantar_start'].strftime('%d %b %Y')} to {details['pratyantar_end'].strftime('%d %b %Y')}"
    gochar = " ".join(transit_notes[:2]) if transit_notes else "Current Gochar support Dasha activation ke saath read kiya gaya."
    return {
        "sku": sku,
        "product_id": sku,
        "name": product["name"],
        "gemstones": product["gemstones"],
        "description": product["description"],
        "benefits": product["benefits"],
        "tags": product["tags"],
        "stock": product["stock"],
        "why": product_ref["why"],
        "planetary_reason": product_ref["why"],
        "dasha_gochar_reason": f"{role} lord {planet_name} active hai. {_planet_chart_context(chart, planet_name)} Gochar check: {gochar}",
        "best_period": period,
        "wearing_instruction": "Right/receiving wrist par subah sankalp ke saath pehnen. Isse spiritual support maana jaye, guaranteed result nahi.",
        "mrp": product["mrp"],
        "price_value": product["price"],
        "discount": product["discount"],
        "price": f"Rs. {product['price']}",
        "image_url": _bracelet_image_url(sku),
        "product_url": _bracelet_checkout_url([sku]),
        "discount_note": "15% AI recommendation discount auto-applies in cart.",
    }


def _build_bracelet_recommendations(chart, goal: Optional[str]):
    details = astrology._vimshottari_details(chart)
    transit_notes = _current_transit_notes(chart)
    ordered_planets = [details["antar"], details["maha"], details["pratyantar"]]
    ordered_planets += GOAL_PLANETS.get(goal or "", [])
    if "Saturn" not in ordered_planets:
        ordered_planets.append("Saturn")
    selected = []
    selected_skus = set()
    for planet in ordered_planets:
        product_ref = BRACELET_BY_PLANET.get(planet)
        sku = product_ref["sku"] if product_ref else ""
        if planet in BRACELET_BY_PLANET and planet not in selected and sku not in selected_skus:
            selected.append(planet)
            selected_skus.add(sku)
        if len(selected) == 3:
            break
    roles = ["Antardasha", "Mahadasha", "Pratyantardasha/Goal"]
    cards = [_bracelet_card(planet, roles[i], chart, details, transit_notes) for i, planet in enumerate(selected)]
    recommended_skus = [card["sku"] for card in cards]
    remedy_planet = details["antar"] if details["antar"] in PLANET_REMEDIES else details["maha"]
    primary = cards[0] if cards else {}
    return {
        "message": (
            f"Current timing {details['maha']} Mahadasha / {details['antar']} Antardasha / "
            f"{details['pratyantar']} Pratyantardasha activate kar raha hai. "
            f"Final conclusion: {primary.get('name', 'recommended bracelet')} sabse strong first choice hai."
        ),
        "mode": "timed_kundli",
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
        "recommended_skus": recommended_skus,
        "checkout_url": _bracelet_checkout_url(recommended_skus),
        "discount_note": "15% AI recommendation discount cart mein automatically apply hoga.",
        "final_remedy": PLANET_REMEDIES.get(remedy_planet, PLANET_REMEDIES["Saturn"]),
        "final_prediction": (
            f"Final conclusion: {primary.get('name', 'selected bracelet')} is chart ke hisaab se strongest match hai. "
            f"{details['maha']}/{details['antar']} activation ke dauraan yeh bracelet discipline, protection aur clarity ko support karega; "
            "next 60-90 days mein is support ko sabse clearly feel karne ka window hai."
        ),
        "disclaimer": "Gemstone bracelets aur remedies spiritual support hain; medical, legal, financial ya guaranteed result ka replacement nahi.",
    }


def _chart_visual_from_row(row):
    if not row.get("chart_visual"):
        return None
    try:
        return json.loads(row["chart_visual"])
    except Exception:
        return None


def _chart_is_current(row) -> bool:
    return bool(row and row.get("chart_summary") and ASTRO_ENGINE_VERSION in row["chart_summary"])


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
        if not _chart_is_current(row):
            db.update(req.session_id, stage="setup", chart_summary=None, chart_visual=None, history="[]")
            return _reply(
                "Maya ka astrology engine update hua hai. Accurate Kundli ke liye birth details dobara fill kijiye; purani saved Dasha reading use nahi hogi.",
                stage="setup",
                show_form=True,
                credits=credit_status["credits"],
                credit_status=credit_status,
            )
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
    if not _has_exact_birth_time(req.tob):
        return _reply(
            "Accurate Kundli ke liye exact birth time required hai. Time unknown ho toh AI Astrologer Kundli calculate nahi karega; bracelet tool numerology fallback use kar sakta hai.",
            ok=False,
        )

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
    if not req.name.strip() or not req.dob.strip():
        return {"ok": False, "error": "Name aur date of birth required hai."}
    try:
        if not _has_exact_birth_time(req.tob):
            result = _build_numerology_bracelet_recommendations(req)
            result["name"] = req.name.strip()
            return result
        if not req.birth_city.strip():
            return {"ok": False, "error": "Exact birth time diya hai, isliye timed Kundli bracelet reading ke liye birth place bhi required hai."}
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

    if not _chart_is_current(row):
        db.update(req.session_id, stage="setup", chart_summary=None, chart_visual=None, history="[]")
        credit_status = db.credit_status(req.session_id, FREE_LIMIT)
        return _reply(
            "Maya ka astrology engine update hua hai. Accurate Kundli ke liye birth details dobara fill kijiye; purani saved Dasha reading use nahi hogi.",
            stage="setup",
            show_form=True,
            credits=credit_status["credits"],
            credit_status=credit_status,
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

    try:
        reading = ai.generate_reading(
            row["chart_summary"],
            text,
            db.get_history(req.session_id),
        )
    except ai.AIConfigurationError as exc:
        print(f"[maya-ai] configuration error: {exc}")
        db.cancel_response_credit(response_id)
        credit_status = db.credit_status(req.session_id, FREE_LIMIT)
        return _reply(
            "Maya ka AI connection abhi setup issue ki wajah se answer nahi de pa raha. Aapke credits deduct nahi hue. Please thodi der baad try karein.",
            stage="ready",
            locked=False,
            response_id=response_id,
            ai_error="configuration",
            credits=credit_status["credits"],
            free_remaining=credit_status["credits"],
            credits_before=credit_status["credits"],
            credits_deducted=0,
            credits_after=credit_status["credits"],
            credit_status=credit_status,
        )
    except ai.AIServiceUnavailable as exc:
        print(f"[maya-ai] service unavailable: {exc}")
        db.cancel_response_credit(response_id)
        credit_status = db.credit_status(req.session_id, FREE_LIMIT)
        return _reply(
            "Maya ka AI service abhi heavy load mein hai. Aapke credits deduct nahi hue. 10-20 seconds baad dobara try kijiye.",
            stage="ready",
            locked=False,
            response_id=response_id,
            ai_error="temporary",
            credits=credit_status["credits"],
            free_remaining=credit_status["credits"],
            credits_before=credit_status["credits"],
            credits_deducted=0,
            credits_after=credit_status["credits"],
            credit_status=credit_status,
        )

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
