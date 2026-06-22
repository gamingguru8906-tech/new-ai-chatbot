"""
astrology.py — Vedic (sidereal) birth-chart engine for Veshannastro.

Two entry points:
  - calculate_chart_from_coords(...) : used by the website (coordinates come
    from the browser's autocomplete, so NO server-side geocoding -> reliable).
  - calculate_chart(...) : convenience for local testing (geocodes a place name).
"""

import datetime as _dt
from dataclasses import dataclass, field
import zoneinfo

import swisseph as swe

swe.set_sid_mode(swe.SIDM_LAHIRI)   # Lahiri ayanamsha = standard Vedic

SIGNS = [
    "Aries (Mesha)", "Taurus (Vrishabha)", "Gemini (Mithuna)",
    "Cancer (Karka)", "Leo (Simha)", "Virgo (Kanya)",
    "Libra (Tula)", "Scorpio (Vrishchika)", "Sagittarius (Dhanu)",
    "Capricorn (Makara)", "Aquarius (Kumbha)", "Pisces (Meena)",
]
SIGN_SHORT = [
    "Ar", "Ta", "Ge", "Ca", "Le", "Vi",
    "Li", "Sc", "Sa", "Cp", "Aq", "Pi",
]
NAKSHATRAS = [
    "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
    "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
    "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
    "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana",
    "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada",
    "Revati",
]
PLANETS = {
    "Sun": swe.SUN, "Moon": swe.MOON, "Mars": swe.MARS, "Mercury": swe.MERCURY,
    "Jupiter": swe.JUPITER, "Venus": swe.VENUS, "Saturn": swe.SATURN,
    "Rahu": swe.MEAN_NODE,
}

# Vimshottari Dasha lords in order (starting from Ketu)
DASHA_ORDER = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu",
               "Jupiter", "Saturn", "Mercury"]
DASHA_YEARS = {"Ketu": 7, "Venus": 20, "Sun": 6, "Moon": 10, "Mars": 7,
               "Rahu": 18, "Jupiter": 16, "Saturn": 19, "Mercury": 17}
# Nakshatra -> starting dasha lord (Vimshottari)
NAK_DASHA_LORD = [
    "Ketu","Venus","Sun","Moon","Mars","Rahu","Jupiter","Saturn","Mercury",  # 1-9
    "Ketu","Venus","Sun","Moon","Mars","Rahu","Jupiter","Saturn","Mercury",  # 10-18
    "Ketu","Venus","Sun","Moon","Mars","Rahu","Jupiter","Saturn","Mercury",  # 19-27
]


@dataclass
class PlanetPosition:
    name: str
    sign: str
    degree: float
    nakshatra: str
    retrograde: bool = False
    house: int = 0          # 1-12


@dataclass
class BirthChart:
    date_of_birth: str
    time_of_birth: str
    place_of_birth: str
    latitude: float
    longitude: float
    ascendant_sign: str
    ascendant_sign_index: int
    moon_sign: str
    sun_sign: str
    nakshatra: str
    nakshatra_index: int        # 0-26
    nakshatra_pada: int         # 1-4
    nakshatra_lord: str
    moon_longitude: float       # sidereal, for dasha calc
    planets: list = field(default_factory=list)
    ascendant_offset: float = 0.0   # degrees within ascendant sign (cusp checks)

    # ---------- computed helpers ----------

    def current_mahadasha(self) -> str:
        """Current Vimshottari Mahadasha lord.

        Delegates to the single authoritative calculator (_vimshottari_periods)
        so the overview block and the detailed dasha block can never disagree.
        """
        try:
            maha, _antar, _me, _ae = _vimshottari_periods(self)
            return maha or "Unknown"
        except Exception:
            return "Unknown"

    def doshas(self) -> dict:
        """Return dict with Manglik, Sade Sati, Kaal Sarp."""
        result = {}

        # --- Manglik: natal Mars in houses 1, 4, 7, 8, or 12 ---
        mars = next((p for p in self.planets if p.name == "Mars"), None)
        result["manglik"] = mars is not None and mars.house in (1, 4, 7, 8, 12)

        # --- Kaal Sarp: all planets hemmed between Rahu and Ketu ---
        rahu = next((p for p in self.planets if p.name == "Rahu"), None)
        ketu = next((p for p in self.planets if p.name == "Ketu"), None)
        if rahu and ketu:
            rahu_h, ketu_h = rahu.house, ketu.house
            others = [p for p in self.planets if p.name not in ("Rahu", "Ketu")]
            def between(h, start, end):
                if start < end:
                    return start < h < end
                return h > start or h < end
            all_one_side = (
                all(between(p.house, rahu_h, ketu_h) for p in others) or
                all(between(p.house, ketu_h, rahu_h) for p in others)
            )
            result["kaal_sarp"] = all_one_side and len(others) > 0
        else:
            result["kaal_sarp"] = False

        # --- Sade Sati: TRANSITING Saturn (today) in 12th, 1st, or 2nd from natal Moon ---
        # This requires computing Saturn's current sidereal longitude via Swiss Ephemeris.
        try:
            import datetime as _dt2
            today = _dt2.date.today()
            jd_today = swe.julday(today.year, today.month, today.day, 12.0)
            flags = swe.FLG_SIDEREAL | swe.FLG_SPEED
            sat_res = swe.calc_ut(jd_today, swe.SATURN, flags)
            transit_sat_lon = sat_res[0][0]
            transit_sat_sign_idx = int(transit_sat_lon // 30) % 12
            moon_sign_idx = SIGNS.index(self.moon_sign)
            # Sade Sati = transiting Saturn in sign 12th, 1st, or 2nd from natal Moon
            # i.e. (transit_sign - moon_sign) % 12 in {11, 0, 1}
            diff = (transit_sat_sign_idx - moon_sign_idx) % 12
            result["sade_sati"] = diff in (11, 0, 1)
        except Exception:
            result["sade_sati"] = False

        return result

    def chart_data(self) -> dict:
        """Return structured data for rendering North Indian kundli chart."""
        houses = {}  # house_number -> {"sign": short, "planets": [...]}
        lagna_idx = self.ascendant_sign_index
        for i in range(12):
            sign_idx = (lagna_idx + i) % 12
            houses[i + 1] = {
                "sign": SIGN_SHORT[sign_idx],
                "sign_num": sign_idx + 1,
                "planets": []
            }
        for p in self.planets:
            if 1 <= p.house <= 12:
                abbr = _planet_abbr(p.name, p.retrograde)
                houses[p.house]["planets"].append(abbr)
        return {
            "lagna": self.ascendant_sign,
            "rashi": self.moon_sign,
            "nakshatra": self.nakshatra,
            "houses": houses
        }

    def summary(self) -> str:
        lines = [
            f"Birth details: {self.date_of_birth} at {self.time_of_birth}, "
            f"{self.place_of_birth}",
            f"Ascendant (Lagna): {self.ascendant_sign}",
            f"Moon sign (Rashi): {self.moon_sign}",
            f"Sun sign: {self.sun_sign}",
            f"Birth Nakshatra: {self.nakshatra} (pada {self.nakshatra_pada}, lord {self.nakshatra_lord})",
            f"Current Mahadasha: {self.current_mahadasha()}",
            "Planetary placements (with house, sign, dignity, nakshatra, retrograde):",
        ]
        sun = next((p for p in self.planets if p.name == "Sun"), None)
        for p in self.planets:
            retro = " [RETROGRADE]" if p.retrograde else ""
            sign_idx = SIGNS.index(p.sign) if p.sign in SIGNS else 0
            d1_dig = _dignity(p.name, sign_idx)
            dig_str = f" [{d1_dig.upper()}]" if d1_dig else ""
            # Combustion: classical per-planet orbs (degrees from Sun).
            combust = ""
            if sun and p.name not in ("Sun", "Moon", "Rahu", "Ketu"):
                sun_lon = SIGNS.index(sun.sign) * 30 + sun.degree
                p_lon = sign_idx * 30 + p.degree
                diff = abs(sun_lon - p_lon)
                if diff > 180: diff = 360 - diff
                # Mercury/Venus take a tighter orb when retrograde (classical).
                orb = {"Mars": 17.0, "Jupiter": 11.0, "Saturn": 15.0,
                       "Mercury": 12.0 if p.retrograde else 14.0,
                       "Venus": 8.0 if p.retrograde else 10.0}.get(p.name, 6.0)
                if diff <= orb:
                    combust = " [COMBUST — weakened, gives results with difficulty]"
            lines.append(f"  - {p.name}: House {p.house}, {p.sign}, "
                         f"{p.degree:.1f}°, Nakshatra {p.nakshatra}"
                         f"{dig_str}{retro}{combust}")
        d = self.doshas()
        lines.append(f"Doshas: Manglik={'yes' if d['manglik'] else 'no'}, "
                     f"Sade Sati={'yes' if d['sade_sati'] else 'no'}, "
                     f"Kaal Sarp={'yes' if d['kaal_sarp'] else 'no'}")
        return "\n".join(lines)

    def overview_block(self) -> str:
        """Short block used in the chart-ready greeting (like screenshot)."""
        d = self.doshas()
        maha = self.current_mahadasha()
        return (
            f"Your Chart Overview\n"
            f"- Rashi (Moon sign): {self.moon_sign}\n"
            f"- Nakshatra: {self.nakshatra} (pada {self.nakshatra_pada}, "
            f"lord {self.nakshatra_lord})\n"
            f"- Lagna (Ascendant): {self.ascendant_sign}\n"
            f"- Current Mahadasha: {maha}\n\n"
            f"Doshas - Manglik: {'yes' if d['manglik'] else 'no'}, "
            f"Sade Sati: {'yes' if d['sade_sati'] else 'no'}, "
            f"Kaal Sarp: {'yes' if d['kaal_sarp'] else 'no'}."
        )


def _planet_abbr(name: str, retro: bool) -> str:
    abbr = {"Sun": "Su", "Moon": "Mo", "Mars": "Ma", "Mercury": "Me",
            "Jupiter": "Ju", "Venus": "Ve", "Saturn": "Sa",
            "Rahu": "Ra", "Ketu": "Ke"}.get(name, name[:2])
    return abbr + "(R)" if retro else abbr


def _sign_of(longitude):
    idx = int(longitude // 30) % 12
    return SIGNS[idx], longitude % 30, idx


def _nakshatra_of(longitude):
    nak_idx = int(longitude // (360 / 27)) % 27
    pada = int((longitude % (360 / 27)) // (360 / 27 / 4)) + 1
    return NAKSHATRAS[nak_idx], nak_idx, pada


def _normalize_time(tob: str) -> tuple[int, int]:
    """Accept '14:30', '2:30 PM', '02:30am', etc. -> (hour24, minute)."""
    t = tob.strip().lower().replace(".", "")
    ampm = None
    if "am" in t:
        ampm = "am"; t = t.replace("am", "").strip()
    elif "pm" in t:
        ampm = "pm"; t = t.replace("pm", "").strip()
    if ":" in t:
        hh, mm = t.split(":")[:2]
    else:
        hh, mm = t, "0"
    hh, mm = int(hh), int(mm)
    if ampm == "pm" and hh < 12:
        hh += 12
    elif ampm == "am" and hh == 12:
        hh = 0
    return hh, mm


def _normalize_date(dob: str) -> tuple[int, int, int]:
    """Parse common date formats to (Y, M, D)."""
    import re
    # Match YYYY-MM-DD or YYYY/MM/DD
    m1 = re.match(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$", dob.strip())
    if m1:
        return int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
    # Match DD-MM-YYYY or DD/MM/YYYY
    m2 = re.match(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$", dob.strip())
    if m2:
        return int(m2.group(3)), int(m2.group(2)), int(m2.group(1))
    
    parts = dob.replace("/", "-").replace(".", "-").split("-")
    if len(parts) == 3:
        if len(parts[0]) == 4:
            return int(parts[0]), int(parts[1]), int(parts[2])
        else:
            return int(parts[2]), int(parts[1]), int(parts[0])
    raise ValueError(f"Could not parse date: {dob}")


def calculate_chart_from_coords(date_of_birth, time_of_birth, latitude,
                                longitude, tz_name, place_label):
    """Compute a sidereal chart directly from coordinates (no geocoding)."""
    y, m, d = _normalize_date(date_of_birth)
    hh, mm = _normalize_time(time_of_birth)
    local_tz = zoneinfo.ZoneInfo(tz_name) if tz_name else _dt.timezone.utc
    local_dt = _dt.datetime(y, m, d, hh, mm, tzinfo=local_tz)
    utc_dt = local_dt.astimezone(_dt.timezone.utc)
    jd = swe.julday(utc_dt.year, utc_dt.month, utc_dt.day,
                    utc_dt.hour + utc_dt.minute / 60.0)

    # Ascendant (Whole Sign houses)
    flags_asc = swe.FLG_SIDEREAL
    asc_lon = swe.houses_ex(jd, latitude, longitude, b'A', flags_asc)[1][0]
    asc_sign, asc_offset, asc_sign_idx = _sign_of(asc_lon)

    flags = swe.FLG_SIDEREAL | swe.FLG_SPEED
    planets = []
    moon_sign, sun_sign, nakshatra = "", "", ""
    moon_nak_idx, moon_pada, moon_nak_lord = 0, 1, "Ketu"
    moon_longitude_sid = 0.0

    for name, body in PLANETS.items():
        res = swe.calc_ut(jd, body, flags)
        lon_deg, speed = res[0][0], res[0][3]
        sign, deg, sign_idx = _sign_of(lon_deg)
        nak, nak_idx, pada = _nakshatra_of(lon_deg)
        # Whole Sign house
        house = (sign_idx - asc_sign_idx) % 12 + 1
        planets.append(PlanetPosition(name, sign, deg, nak, speed < 0, house))
        if name == "Moon":
            moon_sign = sign
            nakshatra = nak
            moon_nak_idx = nak_idx
            moon_pada = pada
            moon_nak_lord = NAK_DASHA_LORD[nak_idx]
            moon_longitude_sid = lon_deg
        if name == "Sun":
            sun_sign = sign

    # Add Ketu (opposite of Rahu)
    rahu = next(p for p in planets if p.name == "Rahu")
    ketu_sign_idx = (SIGNS.index(rahu.sign) + 6) % 12
    ketu_sign = SIGNS[ketu_sign_idx]
    ketu_house = (ketu_sign_idx - asc_sign_idx) % 12 + 1
    planets.append(PlanetPosition(
        "Ketu", ketu_sign, rahu.degree,
        _nakshatra_of(ketu_sign_idx * 30 + rahu.degree)[0],
        False, ketu_house))

    return BirthChart(
        date_of_birth, time_of_birth, place_label, latitude, longitude,
        asc_sign, asc_sign_idx, moon_sign, sun_sign, nakshatra,
        moon_nak_idx, moon_pada, moon_nak_lord, moon_longitude_sid,
        planets, ascendant_offset=asc_offset
    )


def calculate_chart(date_of_birth, time_of_birth, place_of_birth):
    """Local-testing helper: geocodes the place name, then computes."""
    from geopy.geocoders import Nominatim
    from timezonefinder import TimezoneFinder
    loc = Nominatim(user_agent="veshannastro-bot").geocode(place_of_birth, timeout=10)
    if loc is None:
        raise ValueError(f"Could not find location: {place_of_birth!r}")
    tz = TimezoneFinder().timezone_at(lat=loc.latitude, lng=loc.longitude) or "UTC"
    return calculate_chart_from_coords(date_of_birth, time_of_birth,
                                       loc.latitude, loc.longitude, tz,
                                       place_of_birth)




# ===========================================================================
# ADVANCED CONCEPTS — house lords, aspects, navamsa, yogas, dasha, transits
# ===========================================================================

SIGN_LORDS = ["Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
              "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"]

EXALTATION = {"Sun": 0, "Moon": 1, "Mars": 9, "Mercury": 5, "Jupiter": 3,
              "Venus": 11, "Saturn": 6, "Rahu": 1, "Ketu": 7}
DEBILITATION = {p: (s + 6) % 12 for p, s in EXALTATION.items()}
OWN_SIGNS = {"Sun": [4], "Moon": [3], "Mars": [0, 7], "Mercury": [2, 5],
             "Jupiter": [8, 11], "Venus": [1, 6], "Saturn": [9, 10]}

SPECIAL_ASPECTS = {"Mars": [4, 7, 8], "Jupiter": [5, 7, 9], "Saturn": [3, 7, 10]}
DEFAULT_ASPECT = [7]


def _dignity(name, sign_idx):
    if EXALTATION.get(name) == sign_idx: return "exalted"
    if DEBILITATION.get(name) == sign_idx: return "debilitated"
    if sign_idx in OWN_SIGNS.get(name, []): return "own sign"
    return ""


def _navamsa_sign_idx(sid_lon):
    """D9: each sign split into 9 parts of 3deg20'."""
    sign_idx = int(sid_lon // 30) % 12
    part = int((sid_lon % 30) // (30 / 9))
    if sign_idx % 3 == 0: start = sign_idx          # movable -> same sign
    elif sign_idx % 3 == 1: start = (sign_idx + 8) % 12  # fixed -> 9th
    else: start = (sign_idx + 4) % 12               # dual -> 5th
    return (start + part) % 12


def _dashamsha_sign_idx(sid_lon):
    """D10 Dashamsha (career/profession). Sign split into 10 parts of 3°.

    Parashara rule: for ODD signs count the 10 parts from the sign itself;
    for EVEN signs count from the 9th sign from it.
    (sign_idx is 0-based, so 'odd sign' Aries=0 -> sign_idx % 2 == 0.)
    """
    sign_idx = int(sid_lon // 30) % 12
    part = int((sid_lon % 30) // 3)        # 0..9
    start = sign_idx if sign_idx % 2 == 0 else (sign_idx + 8) % 12
    return (start + part) % 12


def _graha_yuddha(chart):
    """Planetary war: two true planets in the same sign within 1°.

    Both combatants are weakened. Determining the *winner* rigorously needs
    ecliptic latitude (not stored here), so we report the war and separation
    factually and flag both as weakened rather than guessing a winner.
    """
    fighters = [p for p in chart.planets
                if p.name not in ("Sun", "Moon", "Rahu", "Ketu")]
    out = []
    for i, a in enumerate(fighters):
        for b in fighters[i + 1:]:
            if a.sign != b.sign:
                continue
            sep = abs(a.degree - b.degree)
            if sep <= 1.0:
                out.append(f"Graha Yuddha: {a.name} ({a.degree:.2f}°) and "
                           f"{b.name} ({b.degree:.2f}°) within {sep:.2f}° in "
                           f"{a.sign} (H{a.house}) — both weakened; the closer "
                           f"planet's results are especially strained")
    return out


def _validate_chart(chart):
    """Quality-control / confidence layer.

    Returns {"confidence": high|medium|low, "issues": [...], "notes": [...]}.
    'issues' are hard correctness problems (the chart should NOT be served).
    'notes' are confidence caveats (chart is served but flagged).
    """
    import datetime as _dt
    issues, notes = [], []

    # --- hard correctness checks ---
    names = {p.name for p in chart.planets}
    expected = {"Sun", "Moon", "Mars", "Mercury", "Jupiter",
                "Venus", "Saturn", "Rahu", "Ketu"}
    missing = expected - names
    if missing:
        issues.append(f"missing planet(s): {', '.join(sorted(missing))}")
    for p in chart.planets:
        if not (0.0 <= p.degree < 30.0):
            issues.append(f"{p.name} degree out of range: {p.degree}")
        if not (1 <= p.house <= 12):
            issues.append(f"{p.name} house out of range: {p.house}")
    if not (0 <= chart.ascendant_sign_index <= 11):
        issues.append(f"ascendant index out of range: {chart.ascendant_sign_index}")
    if not (0.0 <= chart.moon_longitude < 360.0):
        issues.append(f"moon longitude out of range: {chart.moon_longitude}")

    # SAV must total 337
    try:
        if sum(chart.sarvashtakavarga()) != 337:
            issues.append("Sarvashtakavarga does not total 337 (table error)")
    except Exception as e:
        issues.append(f"ashtakavarga failed: {e}")

    # Dasha dates must be sane and ordered
    try:
        maha, antar, maha_end, antar_end = _vimshottari_periods(chart)
        today = _dt.date.today()
        if maha_end <= today:
            issues.append("current Mahadasha end date is in the past")
        if antar_end > maha_end + _dt.timedelta(days=1):
            issues.append("Antardasha ends after its Mahadasha")
    except Exception as e:
        issues.append(f"dasha calculation failed: {e}")

    # --- confidence caveats (birth-time sensitivity) ---
    NAK_SIZE = 360.0 / 27.0
    pos_in_nak = chart.moon_longitude - chart.nakshatra_index * NAK_SIZE
    edge = min(pos_in_nak, NAK_SIZE - pos_in_nak)
    if edge < 0.25:                       # ~ up to a 25-min birth-time error
        nxt = NAK_DASHA_LORD[(chart.nakshatra_index + (1 if pos_in_nak > NAK_SIZE/2 else -1)) % 27]
        notes.append(
            f"Moon is {edge:.2f}° from a nakshatra boundary — a small birth-time "
            f"error could change the birth nakshatra and therefore the starting "
            f"Dasha lord (adjacent lord would be {nxt}). Please confirm the birth time.")

    # Ascendant near a sign cusp -> whole lagna (and all houses) can shift.
    cusp = min(chart.ascendant_offset, 30.0 - chart.ascendant_offset)
    if cusp < 2.0:                        # ascendant moves ~1°/4min
        notes.append(
            f"Ascendant is {cusp:.2f}° from a sign boundary — a birth-time "
            f"error of a few minutes could change the Lagna and every house "
            f"placement. Please confirm the birth time to the minute.")

    if issues:
        confidence = "low"
    elif notes:
        confidence = "medium"
    else:
        confidence = "high"
    return {"confidence": confidence, "issues": issues, "notes": notes}



def _vimshottari_periods(chart, depth_date=None):
    """Return (mahadasha_lord, antardasha_lord, maha_end_date, antar_end_date).

    FIX 1: nak_elapsed_fraction must use (moon_lon - nak_start) / nak_size
            NOT moon_lon % nak_size — the latter is wrong when nak_start != 0.
    FIX 2: antardasha walker must use days relative to maha_start (not negative offset).
    """
    import datetime as dt
    lord = NAK_DASHA_LORD[chart.nakshatra_index]
    total = DASHA_YEARS[lord] * 365.25

    # CORRECT: fraction elapsed = (moon_lon - nakshatra_start) / nakshatra_size
    NAK_SIZE = 360.0 / 27.0
    nak_start_lon = chart.nakshatra_index * NAK_SIZE
    elapsed_fraction = (chart.moon_longitude - nak_start_lon) / NAK_SIZE
    # Clamp to [0,1) for safety
    elapsed_fraction = max(0.0, min(elapsed_fraction, 0.9999))
    elapsed_first = elapsed_fraction * total          # days already used at birth
    remaining_first = total - elapsed_first           # days left in birth dasha

    birth = dt.date.fromisoformat(chart.date_of_birth)
    today = depth_date or dt.date.today()
    days_since_birth = (today - birth).days

    # Walk mahadashas forward from birth
    # Day 0 = birth; first dasha has only remaining_first days left
    day_cursor = 0.0
    idx = DASHA_ORDER.index(lord)

    # First dasha is partial
    if days_since_birth <= remaining_first:
        maha = lord
        maha_start_day = 0.0
        maha_span = remaining_first
    else:
        day_cursor = remaining_first
        idx = (idx + 1) % 9
        maha = None
        maha_start_day = day_cursor
        maha_span = 0.0
        while True:
            maha = DASHA_ORDER[idx]
            maha_span = DASHA_YEARS[maha] * 365.25
            if day_cursor + maha_span > days_since_birth:
                maha_start_day = day_cursor
                break
            day_cursor += maha_span
            idx = (idx + 1) % 9

    maha_end = birth + dt.timedelta(days=maha_start_day + maha_span)

    # Antardasha: walk sub-periods within current mahadasha
    # Antardasha starts from maha lord itself
    a_idx = DASHA_ORDER.index(maha)
    days_into_maha = days_since_birth - maha_start_day
    at = 0.0  # days into maha
    antar = None
    a_span = 0.0
    for _ in range(9):
        antar = DASHA_ORDER[a_idx % 9]
        a_span = maha_span * DASHA_YEARS[antar] / 120.0
        if at + a_span > days_into_maha:
            break
        at += a_span
        a_idx += 1

    antar_end = birth + dt.timedelta(days=maha_start_day + at + a_span)
    return maha, antar, maha_end, antar_end


def _current_transits(asc_sign_idx, moon_sign_idx, natal_planets=None):
    """Sidereal positions today of all major planets + houses + aspects to natal planets."""
    import datetime as dt
    today = dt.date.today()
    jd = swe.julday(today.year, today.month, today.day, 12.0)
    flags = swe.FLG_SIDEREAL | swe.FLG_SPEED
    out = []
    planets_to_check = [
        ("Jupiter", swe.JUPITER),
        ("Saturn", swe.SATURN),
        ("Rahu", swe.MEAN_NODE),
        ("Mars", swe.MARS),
        ("Sun", swe.SUN),
        ("Mercury", swe.MERCURY),
        ("Venus", swe.VENUS),
    ]
    # Build natal house map for aspect targets
    natal_house_map = {}
    if natal_planets:
        for p in natal_planets:
            natal_house_map.setdefault(p.house, []).append(p.name)

    for name, body in planets_to_check:
        res = swe.calc_ut(jd, body, flags)
        lon = res[0][0]
        speed = res[0][3]
        retro = " (R)" if speed < 0 else ""
        s_idx = int(lon // 30) % 12
        house = (s_idx - asc_sign_idx) % 12 + 1
        from_moon = (s_idx - moon_sign_idx) % 12 + 1
        deg = lon % 30

        # Compute which houses this transiting planet aspects
        asp_offsets = SPECIAL_ASPECTS.get(name, DEFAULT_ASPECT)
        asp_houses = sorted(set((house - 1 + a) % 12 + 1 for a in asp_offsets))

        # Find natal planets in aspected houses
        natal_hit = []
        for ah in asp_houses:
            occupants = natal_house_map.get(ah, [])
            for occ in occupants:
                natal_hit.append(f"{occ}(H{ah})")

        aspect_str = ""
        if natal_hit:
            aspect_str = f" — aspects natal {', '.join(natal_hit)}"

        out.append(f"{name}{retro} transiting {SIGNS[s_idx]} {deg:.1f}° = "
                   f"your {_ord(house)} house ({_ord(from_moon)} from Moon){aspect_str}")

        if name == "Rahu":
            k_idx = (s_idx + 6) % 12
            kh = (k_idx - asc_sign_idx) % 12 + 1
            km = (k_idx - moon_sign_idx) % 12 + 1
            out.append(f"Ketu transiting {SIGNS[k_idx]} = your {_ord(kh)} house "
                       f"({_ord(km)} from Moon)")
    return out


# ── Planetary friendship table ──
PLANET_FRIENDS = {
    "Sun":     {"friends": ["Moon","Mars","Jupiter"],       "enemies": ["Venus","Saturn"], "neutral": ["Mercury"]},
    "Moon":    {"friends": ["Sun","Mercury"],                "enemies": [],                "neutral": ["Mars","Jupiter","Venus","Saturn"]},
    "Mars":    {"friends": ["Sun","Moon","Jupiter"],         "enemies": ["Mercury"],        "neutral": ["Venus","Saturn"]},
    "Mercury": {"friends": ["Sun","Venus"],                  "enemies": ["Moon"],           "neutral": ["Mars","Jupiter","Saturn"]},
    "Jupiter": {"friends": ["Sun","Moon","Mars"],            "enemies": ["Mercury","Venus"],"neutral": ["Saturn"]},
    "Venus":   {"friends": ["Mercury","Saturn"],             "enemies": ["Sun","Moon"],     "neutral": ["Mars","Jupiter"]},
    "Saturn":  {"friends": ["Mercury","Venus"],              "enemies": ["Sun","Moon","Mars"],"neutral": ["Jupiter"]},
    "Rahu":    {"friends": ["Venus","Saturn","Mercury"],     "enemies": ["Sun","Moon","Mars"],"neutral": ["Jupiter"]},
    "Ketu":    {"friends": ["Mars","Venus","Saturn"],        "enemies": ["Sun","Moon"],     "neutral": ["Mercury","Jupiter"]},
}

def _planet_relationship(p1, p2):
    """Returns 'friend', 'enemy', or 'neutral' relationship of p1 toward p2."""
    rel = PLANET_FRIENDS.get(p1, {})
    if p2 in rel.get("friends", []): return "friend"
    if p2 in rel.get("enemies", []): return "enemy"
    return "neutral"


def _conjunctions(chart):
    """Planets sharing the same house — explicitly listed."""
    from collections import defaultdict
    house_map = defaultdict(list)
    for p in chart.planets:
        house_map[p.house].append(p.name)
    lines = []
    for h in range(1, 13):
        occupants = house_map[h]
        if len(occupants) >= 2:
            lines.append(f"House {h} conjunction: {', '.join(occupants)} — planets share same house, mutually influence each other")
        elif len(occupants) == 1:
            lines.append(f"House {h}: {occupants[0]}")
        else:
            lines.append(f"House {h}: empty")
    return lines


def _parivartana_yogas(chart):
    """Planets in each other's signs = exchange yoga."""
    SIGN_LORDS_LOOKUP = {
        "Aries (Mesha)": "Mars", "Taurus (Vrishabha)": "Venus",
        "Gemini (Mithuna)": "Mercury", "Cancer (Karka)": "Moon",
        "Leo (Simha)": "Sun", "Virgo (Kanya)": "Mercury",
        "Libra (Tula)": "Venus", "Scorpio (Vrishchika)": "Mars",
        "Sagittarius (Dhanu)": "Jupiter", "Capricorn (Makara)": "Saturn",
        "Aquarius (Kumbha)": "Saturn", "Pisces (Meena)": "Jupiter",
    }
    P = {p.name: p for p in chart.planets}
    found = []
    checked = set()
    for p1 in chart.planets:
        if p1.name in ("Rahu", "Ketu"): continue
        sign_lord = SIGN_LORDS_LOOKUP.get(p1.sign)
        if not sign_lord or sign_lord == p1.name: continue
        p2 = P.get(sign_lord)
        if not p2 or p2.name in ("Rahu", "Ketu"): continue
        # Check if p2 is in p1's sign
        sign_lord2 = SIGN_LORDS_LOOKUP.get(p2.sign)
        if sign_lord2 == p1.name:
            pair = tuple(sorted([p1.name, p2.name]))
            if pair not in checked:
                checked.add(pair)
                h1, h2 = p1.house, p2.house
                found.append(f"Parivartana Yoga: {p1.name}(H{h1}) in {p1.sign} and "
                           f"{p2.name}(H{h2}) in {p2.sign} — exchange of houses, "
                           f"activates both H{h1} and H{h2} themes strongly")
    return found


def _vargottama(chart):
    """Planets in same sign in D1 and D9 — very strong."""
    found = []
    for p in chart.planets:
        if p.name in ("Rahu", "Ketu"): continue
        sid = SIGNS.index(p.sign) * 30 + p.degree
        d9_idx = _navamsa_sign_idx(sid)
        d1_idx = SIGNS.index(p.sign)
        if d1_idx == d9_idx:
            found.append(f"{p.name} in house {p.house} ({p.sign}) is VARGOTTAMA "
                        f"(same sign in D1 and D9) — very strong, delivers results powerfully")
    return found


def _atmakaraka(chart):
    """Planet with highest degree (ignoring Rahu/Ketu) = Atmakaraka."""
    candidates = [p for p in chart.planets if p.name not in ("Rahu", "Ketu")]
    if not candidates: return None
    ak = max(candidates, key=lambda p: p.degree)
    return ak


def _neecha_bhanga(chart):
    """Debilitated planets that get cancellation."""
    P = {p.name: p for p in chart.planets}
    lords = chart.house_lords_map()
    results = []
    for p in chart.planets:
        sign_idx = SIGNS.index(p.sign) if p.sign in SIGNS else -1
        if DEBILITATION.get(p.name) != sign_idx: continue
        # Condition 1: Lord of debilitation sign is in kendra from Lagna or Moon
        deb_sign_lord = SIGN_LORDS[sign_idx]
        deb_lord_planet = P.get(deb_sign_lord)
        moon = P.get("Moon")
        cancellation = False
        reason = ""
        if deb_lord_planet and deb_lord_planet.house in (1, 4, 7, 10):
            cancellation = True
            reason = f"lord of debilitation sign ({deb_sign_lord}) is in kendra (H{deb_lord_planet.house})"
        elif deb_lord_planet and moon and (deb_lord_planet.house - moon.house) % 12 + 1 in (1, 4, 7, 10):
            cancellation = True
            reason = f"lord of debilitation sign is in kendra from Moon"
        # Condition 2: Exaltation lord is in kendra
        exalt_sign_idx = EXALTATION.get(p.name)
        if exalt_sign_idx is not None:
            exalt_lord = SIGN_LORDS[exalt_sign_idx]
            exalt_planet = P.get(exalt_lord)
            if exalt_planet and exalt_planet.house in (1, 4, 7, 10):
                cancellation = True
                reason = f"exaltation lord ({exalt_lord}) is in kendra (H{exalt_planet.house})"
        if cancellation:
            results.append(f"Neecha Bhanga for {p.name} in {p.sign} (H{p.house}): "
                          f"debilitation cancelled — {reason}. "
                          f"This planet becomes strong after initial struggle.")
        else:
            results.append(f"{p.name} debilitated in {p.sign} (H{p.house}) — "
                          f"NO cancellation found. Results in its themes are genuinely difficult.")
    return results


def _mahapurusha_yogas(chart):
    """Five Mahapurusha Yogas — planet in own sign or exaltation in kendra."""
    YOGA_NAMES = {
        "Mars": "Ruchaka Yoga (powerful, courageous, disciplined leader)",
        "Mercury": "Bhadra Yoga (intelligent, eloquent, skilled in communication)",
        "Jupiter": "Hamsa Yoga (wise, spiritual, respected, blessed life)",
        "Venus": "Malavya Yoga (beautiful, artistic, wealthy, pleasures in life)",
        "Saturn": "Shasha Yoga (powerful, authority, discipline, long-lasting success)",
    }
    yogas = []
    for p in chart.planets:
        if p.name not in YOGA_NAMES: continue
        sign_idx = SIGNS.index(p.sign) if p.sign in SIGNS else -1
        is_own = sign_idx in OWN_SIGNS.get(p.name, [])
        is_exalted = EXALTATION.get(p.name) == sign_idx
        if (is_own or is_exalted) and p.house in (1, 4, 7, 10):
            yogas.append(f"{YOGA_NAMES[p.name]}: {p.name} in "
                        f"{'own sign' if is_own else 'exaltation'} "
                        f"({p.sign}) in kendra (H{p.house})")
    return yogas


def _viparita_raj_yoga(chart):
    """Lords of 6th, 8th, 12th in each other's houses = Viparita Raj Yoga."""
    lords = chart.house_lords_map()
    P = {p.name: p for p in chart.planets}
    dusthana = {6, 8, 12}
    dusthana_lords = {lords[h]: h for h in dusthana}
    results = []
    for planet, orig_house in dusthana_lords.items():
        pl = P.get(planet)
        if not pl: continue
        # Planet must be in another dusthana house (not its own)
        if pl.house in dusthana and pl.house != orig_house:
            results.append(f"Viparita Raj Yoga: {planet} (lord of H{orig_house}) "
                          f"sits in H{pl.house} — dusthana lord in another dusthana. "
                          f"Gives unexpected rise, success through adversity.")
    return results


def _dhana_yogas(chart):
    """Basic Dhana (wealth) yogas."""
    lords = chart.house_lords_map()
    P = {p.name: p for p in chart.planets}
    results = []
    l2 = lords.get(2); l11 = lords.get(11)
    l5 = lords.get(5); l9 = lords.get(9)
    p2 = P.get(l2); p11 = P.get(l11)
    p5 = P.get(l5); p9 = P.get(l9)
    # 2nd and 11th lords conjunct or in each other's houses
    if p2 and p11 and p2.house == p11.house:
        results.append(f"Dhana Yoga: Lords of 2nd ({l2}) and 11th ({l11}) conjunct in H{p2.house} — strong wealth accumulation")
    if p2 and p11 and p2.house == 11:
        results.append(f"Dhana Yoga: 2nd lord {l2} in 11th house — income and wealth strongly linked")
    if p5 and p9 and p5.house == p9.house:
        results.append(f"Lakshmi Yoga potential: Lords of 5th ({l5}) and 9th ({l9}) conjunct in H{p5.house} — fortune and prosperity")
    return results


# ===========================================================================
# ADVANCED ANALYSIS — Jaimini karakas, special lagnas, and graded domain
# synthesis for CAREER, WEALTH and RELATIONSHIPS. Everything here is computed
# from the chart so the AI writes from evidence, never from guesswork.
# ===========================================================================

_CHARA_KARAKA_LABELS = [
    ("AK", "Atmakaraka — soul, core self, life direction"),
    ("AmK", "Amatyakaraka — career, profession, livelihood (KEY for career)"),
    ("BK", "Bhratrikaraka — siblings, courage, effort"),
    ("MK", "Matrikaraka — mother, home, emotional base"),
    ("PiK", "Putrakaraka — children, intelligence, creativity"),
    ("GK", "Gnatikaraka — obstacles, disputes, health"),
    ("DK", "Darakaraka — spouse, partnerships (KEY for relationships)"),
]


def _chara_karakas(chart):
    """Jaimini 7-planet Chara Karakas, by degree-within-sign descending.

    AK = highest degree, DK = lowest. Amatyakaraka (career) and Darakaraka
    (spouse) are the workhorses for the career and relationship readings.
    """
    seven = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]
    ps = [p for p in chart.planets if p.name in seven]
    ps_sorted = sorted(ps, key=lambda p: p.degree, reverse=True)
    out = []
    for (abbr, desc), p in zip(_CHARA_KARAKA_LABELS, ps_sorted):
        out.append((abbr, p.name, p, desc))
    return out


def _karaka(chart, abbr):
    for a, name, p, desc in _chara_karakas(chart):
        if a == abbr:
            return p
    return None


_INDU_KALA = {"Sun": 30, "Moon": 16, "Mars": 6, "Mercury": 8,
              "Jupiter": 10, "Venus": 12, "Saturn": 1}


def _indu_lagna_idx(chart):
    """Indu Lagna (Dhana Lagna) — a wealth-specific special ascendant.

    Sum the 'kala' values of the 9th lord from the Lagna and the 9th lord
    from the Moon, mod 12, and count that many signs from the Moon.
    """
    lords = chart.house_lords_map()
    moon = next((p for p in chart.planets if p.name == "Moon"), None)
    if not moon:
        return None
    moon_sign = SIGNS.index(moon.sign)
    ninth_from_lagna_lord = lords[9]
    ninth_from_moon_sign = (moon_sign + 8) % 12
    ninth_from_moon_lord = SIGN_LORDS[ninth_from_moon_sign]
    total = _INDU_KALA.get(ninth_from_lagna_lord, 0) + _INDU_KALA.get(ninth_from_moon_lord, 0)
    rem = total % 12 or 12
    return (moon_sign + rem - 1) % 12


def _arudha_pada(chart, house):
    """Jaimini Arudha pada of a house (BPHS rule).

    The pada is as far from the house-lord as the lord is from the house.
    Exception: if the pada falls in the house itself (1st) or the 7th from
    it, take the 10th sign from the pada instead.
    """
    lords = chart.house_lords_map()
    P = {p.name: p for p in chart.planets}
    lord = lords[house]
    lp = P.get(lord)
    if not lp:
        return None
    house_sign = (chart.ascendant_sign_index + house - 1) % 12
    lord_sign = SIGNS.index(lp.sign)
    dist = (lord_sign - house_sign) % 12 + 1          # house -> lord (1..12)
    pada = (lord_sign + dist - 1) % 12                # dist signs from lord
    rel = (pada - house_sign) % 12
    if rel in (0, 6):                                 # 1st or 7th from house
        pada = (pada + 9) % 12                        # 10th from pada
    return pada


# ---- graded domain synthesis ----------------------------------------------

def _grade_house(chart, house):
    """Return (score, factors[]) grading a house from classical strength cues."""
    lords = chart.house_lords_map()
    P = {p.name: p for p in chart.planets}
    house_sign = (chart.ascendant_sign_index + house - 1) % 12
    score, factors = 0, []

    lord = lords[house]
    lp = P.get(lord)
    if lp:
        ls = SIGNS.index(lp.sign)
        dig = _dignity(lord, ls)
        if dig in ("exalted", "own sign"):
            score += 2; factors.append(f"{_ord(house)} lord {lord} is {dig} (strong)")
        elif dig == "debilitated":
            score -= 2; factors.append(f"{_ord(house)} lord {lord} is debilitated (weak)")
        else:
            rel = _planet_relationship(lord, SIGN_LORDS[ls])
            if rel == "friend":
                score += 1; factors.append(f"{_ord(house)} lord {lord} in a friendly sign")
            elif rel == "enemy":
                score -= 1; factors.append(f"{_ord(house)} lord {lord} in an enemy sign")
        if lp.house in (1, 4, 7, 10):
            score += 1; factors.append(f"{_ord(house)} lord {lord} in a kendra (H{lp.house})")
        elif lp.house in (1, 5, 9):
            score += 1; factors.append(f"{_ord(house)} lord {lord} in a trikona (H{lp.house})")
        elif lp.house in (6, 8, 12):
            score -= 1; factors.append(f"{_ord(house)} lord {lord} in a dusthana (H{lp.house})")
        if lp.retrograde:
            factors.append(f"{_ord(house)} lord {lord} retrograde (results internalised/delayed)")

    # Ashtakavarga strength of the house
    try:
        sav = chart.sarvashtakavarga()[house_sign]
        if sav >= 30:
            score += 1; factors.append(f"SAV {sav} bindus (above average — supportive)")
        elif sav < 25:
            score -= 1; factors.append(f"SAV {sav} bindus (below average — needs effort)")
        else:
            factors.append(f"SAV {sav} bindus (average)")
    except Exception:
        pass

    # Aspects onto the house
    for p in chart.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        asp = SPECIAL_ASPECTS.get(p.name, DEFAULT_ASPECT)
        if any((p.house - 1 + a) % 12 + 1 == house for a in asp):
            if p.name in ("Jupiter", "Venus", "Mercury", "Moon"):
                score += 1; factors.append(f"benefic {p.name} aspects the {_ord(house)} house (helps)")
            elif p.name in ("Saturn", "Mars", "Sun"):
                factors.append(f"malefic {p.name} aspects the {_ord(house)} house (pressure/discipline)")

    # Occupants
    occ = [p.name for p in chart.planets if p.house == house]
    if occ:
        factors.append(f"occupied by {', '.join(occ)}")
    return score, factors


def _grade_label(score):
    if score >= 3:
        return "STRONG — results come with relatively less resistance"
    if score >= 0:
        return "MODERATE — solid potential that rewards sustained effort"
    return "CHALLENGED — meaningful effort or remedies needed; time it with supportive dashas"


def _domain_block(chart, title, houses, karaka_abbr, varga_label, varga_fn, extra_lines):
    """Assemble a graded, evidence-anchored block for one life domain."""
    lines = [f"{title} (graded synthesis — base the reading on these factors):"]
    total = 0
    for h in houses:
        s, fac = _grade_house(chart, h)
        total += s
        lines.append(f"  - {_ord(h)} house [{_grade_label(s)}]")
        for f in fac:
            lines.append(f"      · {f}")
    # Jaimini karaka
    if karaka_abbr:
        k = _karaka(chart, karaka_abbr)
        if k:
            kd = _dignity(k.name, SIGNS.index(k.sign))
            lines.append(f"  - {karaka_abbr} (Jaimini significator): {k.name} in {k.sign} "
                         f"(H{k.house}{', ' + kd if kd else ''})")
    # Divisional confirmation
    if varga_fn:
        lines.append(f"  - {varga_label} confirmation:")
        for t in varga_fn():
            lines.append(f"      · {t}")
    lines += [f"  - {e}" for e in extra_lines]
    lines.append(f"  => Overall {title.split('(')[0].strip().lower()} grade: {_grade_label(total)}")
    return lines


def _career_analysis(chart):
    """Advanced career synthesis: 10th + 10th-from-Moon + 10th-from-Sun, D10,
    Amatyakaraka, Sun (authority), Saturn (karma karaka), A10 (public image)."""
    P = {p.name: p for p in chart.planets}
    # 10th from Moon and from Sun (the 'three lagnas' approach)
    extra = []
    moon = P.get("Moon"); sun = P.get("Sun")
    if moon:
        tenth_from_moon = (SIGNS.index(moon.sign) + 9) % 12
        extra.append(f"10th from Moon = {SIGNS[tenth_from_moon]} (career seen from the mind)")
    if sun:
        tenth_from_sun = (SIGNS.index(sun.sign) + 9) % 12
        extra.append(f"10th from Sun = {SIGNS[tenth_from_sun]} (career seen from the soul/father)")
    a10 = _arudha_pada(chart, 10)
    if a10 is not None:
        extra.append(f"A10 (Arudha of 10th — how the career is PERCEIVED publicly): {SIGNS[a10]}")
    sun_dig = _dignity("Sun", SIGNS.index(sun.sign)) if sun else ""
    if sun:
        extra.append(f"Sun (authority/recognition): {sun.sign} H{sun.house}"
                     f"{', ' + sun_dig if sun_dig else ''}")
    sat = P.get("Saturn")
    if sat:
        extra.append(f"Saturn (karma karaka — work ethic & timing): {sat.sign} H{sat.house}")
    return _domain_block(
        chart, "ADVANCED CAREER ANALYSIS", [10], "AmK",
        "D10 Dashamsha", chart.dashamsha_text, extra)


def _wealth_analysis(chart):
    """Advanced wealth synthesis: 2nd (savings) + 11th (gains), Dhana yogas,
    Indu Lagna, Jupiter (dhana karaka)."""
    P = {p.name: p for p in chart.planets}
    extra = []
    indu = _indu_lagna_idx(chart)
    if indu is not None:
        h = (indu - chart.ascendant_sign_index) % 12 + 1
        extra.append(f"Indu Lagna (Dhana Lagna — wealth ascendant): {SIGNS[indu]} "
                     f"(your H{h}); its strength and dasha activation flag wealth peaks")
    jup = P.get("Jupiter")
    if jup:
        jd = _dignity("Jupiter", SIGNS.index(jup.sign))
        extra.append(f"Jupiter (dhana karaka — wealth significator): {jup.sign} "
                     f"H{jup.house}{', ' + jd if jd else ''}")
    dh = _dhana_yogas(chart)
    extra += dh if dh else ["No classical Dhana Yoga detected — wealth builds steadily, not in leaps"]
    return _domain_block(
        chart, "ADVANCED WEALTH ANALYSIS", [2, 11], None,
        None, None, extra)


def _relationship_analysis(chart):
    """Advanced relationship synthesis: 7th house, Venus (kalatra karaka),
    Darakaraka, D9 Navamsa, Upapada Lagna, Manglik."""
    P = {p.name: p for p in chart.planets}
    extra = []
    ven = P.get("Venus")
    if ven:
        vd = _dignity("Venus", SIGNS.index(ven.sign))
        extra.append(f"Venus (kalatra karaka — partner & love; primary for a male native): "
                     f"{ven.sign} H{ven.house}{', ' + vd if vd else ''}")
        seventh_from_venus = (SIGNS.index(ven.sign) + 6) % 12
        extra.append(f"7th from Venus = {SIGNS[seventh_from_venus]} (relationship seen from the karaka)")
    jup = P.get("Jupiter")
    if jup:
        extra.append(f"Jupiter (partner significator for a female native): {jup.sign} H{jup.house}")
    ul = _arudha_pada(chart, 12)
    if ul is not None:
        h = (ul - chart.ascendant_sign_index) % 12 + 1
        extra.append(f"Upapada Lagna (UL — Jaimini marriage significator): {SIGNS[ul]} "
                     f"(your H{h}); planets with/aspecting UL colour the marriage")
    d = chart.doshas()
    extra.append(f"Manglik (Mars dosha): {'YES — assess from Lagna/Moon/Venus and check cancellation' if d['manglik'] else 'no'}")
    return _domain_block(
        chart, "ADVANCED RELATIONSHIP ANALYSIS", [7], "DK",
        "D9 Navamsa", chart.navamsa_text, extra)


def _sade_sati_status(chart):
    """Check if native is in Sade Sati or Dhaiya (Saturn transit phases)."""
    import datetime as dt
    today = dt.date.today()
    jd = swe.julday(today.year, today.month, today.day, 12.0)
    flags = swe.FLG_SIDEREAL | swe.FLG_SPEED
    sat_lon = swe.calc_ut(jd, swe.SATURN, flags)[0][0]
    sat_sign_idx = int(sat_lon // 30) % 12

    moon_sign_idx = SIGNS.index(chart.moon_sign) if chart.moon_sign in SIGNS else 0

    # Sade Sati: Saturn in 12th, 1st, or 2nd from Moon
    rel = (sat_sign_idx - moon_sign_idx) % 12
    if rel == 11:  # 12th from Moon
        phase = "Phase 1 (rising phase — mental restlessness, expenses rise)"
    elif rel == 0:  # 1st — on Moon
        phase = "Phase 2 (peak phase — most intense, health/emotional pressure)"
    elif rel == 1:  # 2nd from Moon
        phase = "Phase 3 (setting phase — family/finances tested, slowly easing)"
    else:
        phase = None

    # Dhaiya (Kantaka Shani): Saturn in 4th or 8th from Moon
    dhaiya = None
    if rel == 3:
        dhaiya = "Kantaka Shani — Saturn in 4th from Moon (domestic stress, career blocks)"
    elif rel == 7:
        dhaiya = "Ashtama Shani — Saturn in 8th from Moon (obstacles, health caution)"

    if phase:
        return [f"SADE SATI ACTIVE — Saturn transiting {SIGNS[sat_sign_idx]}, {phase}. "
                f"This is a karmic cleansing period — hard work brings delayed but lasting results."]
    elif dhaiya:
        return [f"DHAIYA ACTIVE — {dhaiya}. Requires patience and discipline."]
    else:
        return [f"NOT in Sade Sati or Dhaiya. Saturn transiting {SIGNS[sat_sign_idx]}, "
                f"{_ord(rel+1)} from Moon — relatively comfortable Saturn phase."]


def _dasha_relationship(maha_lord, antar_lord):
    """Relationship between Maha and Antar lords."""
    rel_maha_to_antar = _planet_relationship(maha_lord, antar_lord)
    rel_antar_to_maha = _planet_relationship(antar_lord, maha_lord)
    if rel_maha_to_antar == "friend" and rel_antar_to_maha == "friend":
        quality = "MUTUALLY FRIENDLY — excellent, both lords cooperate, results flow smoothly"
    elif rel_maha_to_antar == "enemy" or rel_antar_to_maha == "enemy":
        quality = "HOSTILE — tension between dasha lords, results come with friction or delay"
    else:
        quality = "NEUTRAL — moderate results, neither strongly supportive nor obstructive"
    return quality


def _detect_yogas(chart):
    yogas = []
    P = {p.name: p for p in chart.planets}
    moon, jup = P.get("Moon"), P.get("Jupiter")
    sun, mer = P.get("Sun"), P.get("Mercury")
    if moon and jup and (jup.house - moon.house) % 12 in (0, 3, 6, 9):
        yogas.append("Gajakesari Yoga (Jupiter in kendra from Moon) - wisdom, reputation, lasting success")
    if sun and mer and sun.house == mer.house:
        yogas.append("Budh-Aditya Yoga (Sun+Mercury together) - sharp intellect, communication, administrative skill")
    if moon and any(P.get(n) and abs(P[n].house - moon.house) % 12 not in (0,) and (P[n].house - moon.house) % 12 in (1, 11) for n in ("Mars","Mercury","Jupiter","Venus","Saturn")):
        pass  # Sunapha/Anapha too granular; skip
    # Chandra-Mangal
    mars = P.get("Mars")
    if moon and mars and moon.house == mars.house:
        yogas.append("Chandra-Mangal Yoga (Moon+Mars together) - earning ability, drive with money")
    # Kendra-Trikona Raj Yoga via lords
    lords = chart.house_lords_map()
    kendra_lords = {lords[h] for h in (1, 4, 7, 10)}
    trikona_lords = {lords[h] for h in (1, 5, 9)}
    for p in chart.planets:
        if p.name in kendra_lords and p.name in trikona_lords and p.name != "Rahu":
            yogas.append(f"Raj Yoga potential - {p.name} lords both a kendra and a trikona house")
            break
    # dignity-based
    for p in chart.planets:
        dg = _dignity(p.name, SIGNS.index(p.sign))
        if dg == "exalted":
            yogas.append(f"{p.name} exalted in {p.sign} (house {p.house}) - very strong results")
        elif dg == "debilitated":
            yogas.append(f"{p.name} debilitated in {p.sign} (house {p.house}) - needs remedies/effort in its themes")
    return yogas


def _aspects_received(chart):
    """Which houses each planet aspects (Vedic full aspects)."""
    lines = []
    for p in chart.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        asp = SPECIAL_ASPECTS.get(p.name, DEFAULT_ASPECT)
        houses = sorted(set((p.house - 1 + a) % 12 + 1 for a in asp))
        lines.append(f"{p.name} (house {p.house}) aspects house(s) {', '.join(map(str, houses))}")
    return lines


def _aspects_on_houses(chart):
    """Which planets aspect each house — house-centric view to prevent hallucination."""
    house_aspects = {h: [] for h in range(1, 13)}
    for p in chart.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        asp = SPECIAL_ASPECTS.get(p.name, DEFAULT_ASPECT)
        for a in asp:
            target = (p.house - 1 + a) % 12 + 1
            house_aspects[target].append(f"{p.name}(H{p.house})")
    lines = []
    for h in range(1, 13):
        if house_aspects[h]:
            lines.append(f"House {h} receives aspects from: {', '.join(house_aspects[h])}")
        else:
            lines.append(f"House {h}: no planetary aspects")
    return lines


def _mutual_aspects(chart):
    """Planets that mutually aspect each other — powerful combinations."""
    lines = []
    planets = [p for p in chart.planets if p.name not in ("Rahu", "Ketu")]
    for i, p1 in enumerate(planets):
        for p2 in planets[i+1:]:
            asp1 = set((p1.house - 1 + a) % 12 + 1 for a in SPECIAL_ASPECTS.get(p1.name, DEFAULT_ASPECT))
            asp2 = set((p2.house - 1 + a) % 12 + 1 for a in SPECIAL_ASPECTS.get(p2.name, DEFAULT_ASPECT))
            if p2.house in asp1 and p1.house in asp2:
                lines.append(f"{p1.name}(H{p1.house}) and {p2.name}(H{p2.house}) mutually aspect each other")
    return lines


def _enemy_signs(chart):
    """Planets in enemy signs — reduces their ability to deliver results.

    SINGLE SOURCE OF TRUTH: enmity is derived from PLANET_FRIENDS (the same
    table used for dasha-lord relationship quality), so the summary can never
    say "X in enemy sign of Y" while elsewhere calling X and Y friends.
    """
    lines = []
    for p in chart.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        sign_idx = SIGNS.index(p.sign) if p.sign in SIGNS else -1
        if sign_idx < 0:
            continue
        sign_lord = SIGN_LORDS[sign_idx]
        if sign_lord == p.name:
            continue
        if _planet_relationship(p.name, sign_lord) == "enemy":
            lines.append(f"{p.name} in {p.sign} (house {p.house}) — in enemy sign of "
                         f"{sign_lord}, results are reduced or come with struggle")
    return lines


# ---- attach methods to BirthChart -----------------------------------------


def _ord(n):
    return f"{n}{'st' if n%10==1 and n!=11 else 'nd' if n%10==2 and n!=12 else 'rd' if n%10==3 and n!=13 else 'th'}"

def _house_lords_map(self):
    """house number -> lord planet name (Whole Sign from Lagna)."""
    return {h: SIGN_LORDS[(self.ascendant_sign_index + h - 1) % 12]
            for h in range(1, 13)}
BirthChart.house_lords_map = _house_lords_map


def _house_lords_text(self):
    lords = self.house_lords_map()
    P = {p.name: p for p in self.planets}
    out = []
    for h in range(1, 13):
        lord = lords[h]
        pl = P.get(lord)
        if pl:
            out.append(f"{_ord(h)} lord {lord} sits in house {pl.house} ({pl.sign})")
    return out
BirthChart.house_lords_text = _house_lords_text


def _navamsa_text(self):
    out = []
    for p in self.planets:
        sid = SIGNS.index(p.sign) * 30 + p.degree
        n_idx = _navamsa_sign_idx(sid)
        dg = _dignity(p.name, n_idx)
        out.append(f"{p.name} in {SIGNS[n_idx]}" + (f" ({dg})" if dg else ""))
    return out
BirthChart.navamsa_text = _navamsa_text


def _dashamsha_text(self):
    """D10 Dashamsha positions — primary divisional chart for career/profession."""
    out = []
    for p in self.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        sid = SIGNS.index(p.sign) * 30 + p.degree
        d10_idx = _dashamsha_sign_idx(sid)
        dg = _dignity(p.name, d10_idx)
        out.append(f"{p.name} in {SIGNS[d10_idx]}" + (f" ({dg})" if dg else ""))
    return out
BirthChart.dashamsha_text = _dashamsha_text


def _simple_varga_sign_idx(sid_lon, division):
    """Supplemental varga sign mapping for context-only divisional checks.

    D9 and D10 keep their dedicated functions above. These additional vargas
    are surfaced as supporting evidence; the prediction layer still needs D1,
    dasha, transit, karaka, and Ashtakavarga confirmation.
    """
    sign_idx = int(sid_lon // 30) % 12
    degree_in_sign = sid_lon % 30
    part = min(division - 1, int(degree_in_sign / (30.0 / division)))

    if division == 7:
        start = sign_idx if sign_idx % 2 == 0 else (sign_idx + 6) % 12
        return (start + part) % 12
    if division == 12:
        return (sign_idx + part) % 12
    if division == 16:
        starts = {0: 0, 1: 4, 2: 8}  # movable, fixed, dual
        return (starts[sign_idx % 3] + part) % 12
    if division == 24:
        start = 4 if sign_idx % 2 == 0 else 3
        return (start + part) % 12
    if division == 30:
        # Parashari Trimsamsa lords mapped to their signs.
        d = degree_in_sign
        odd = sign_idx % 2 == 0
        if odd:
            if d < 5: return 0   # Mars/Aries
            if d < 10: return 10 # Saturn/Aquarius
            if d < 18: return 8  # Jupiter/Sagittarius
            if d < 25: return 2  # Mercury/Gemini
            return 6             # Venus/Libra
        if d < 5: return 1       # Venus/Taurus
        if d < 12: return 5      # Mercury/Virgo
        if d < 20: return 11     # Jupiter/Pisces
        if d < 25: return 9      # Saturn/Capricorn
        return 7                 # Mars/Scorpio
    if division == 60:
        return (sign_idx + part) % 12
    return sign_idx


def _varga_text(self, division, label, caution=None):
    out = []
    for p in self.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        sid = SIGNS.index(p.sign) * 30 + p.degree
        idx = _simple_varga_sign_idx(sid, division)
        dg = _dignity(p.name, idx)
        out.append(f"{p.name} in {SIGNS[idx]}" + (f" ({dg})" if dg else ""))
    if caution:
        return [f"{label}: {caution}"] + [f"  {line}" for line in out]
    return [f"{label}:"] + [f"  {line}" for line in out]


def _supplemental_vargas_text(self):
    return (
        _varga_text(self, 7, "D7 Saptamsha (children/creative legacy support)")
        + _varga_text(self, 12, "D12 Dwadashamsha (parents/ancestral pattern support)")
        + _varga_text(self, 16, "D16 Shodashamsha (comforts/vehicles/property support)")
        + _varga_text(self, 24, "D24 Chaturvimshamsha (education/learning support)")
        + _varga_text(self, 30, "D30 Trimsamsha (health/obstacle support)")
        + _varga_text(
            self,
            60,
            "D60 Shashtiamsha (karma micro-pattern)",
            "use only if birth time is highly accurate; otherwise treat as low-confidence context",
        )
    )
BirthChart.supplemental_vargas_text = _supplemental_vargas_text


def _validate(self):
    return _validate_chart(self)
BirthChart.validate = _validate


def _career_analysis_m(self):  return _career_analysis(self)
def _wealth_analysis_m(self):  return _wealth_analysis(self)
def _relationship_analysis_m(self):  return _relationship_analysis(self)
def _chara_karakas_m(self):  return _chara_karakas(self)
BirthChart.career_analysis = _career_analysis_m
BirthChart.wealth_analysis = _wealth_analysis_m
BirthChart.relationship_analysis = _relationship_analysis_m
BirthChart.chara_karakas = _chara_karakas_m


def _upcoming_transits(chart):
    import datetime as dt
    lines = []
    try:
        today = dt.date.today()
        current_signs = {}
        flags = swe.FLG_SIDEREAL | swe.FLG_SPEED
        jd_today = swe.julday(today.year, today.month, today.day, 12.0)
        
        for name, body in [("Jupiter", swe.JUPITER), ("Saturn", swe.SATURN), ("Rahu", swe.MEAN_NODE)]:
            lon = swe.calc_ut(jd_today, body, flags)[0][0]
            current_signs[name] = int(lon // 30) % 12
            
        found = {"Jupiter": [], "Saturn": [], "Rahu": []}
        
        # Scan next 3.5 years (approx 1300 days) with a 10-day step
        for day_offset in range(1, 1300, 10):
            d = today + dt.timedelta(days=day_offset)
            jd = swe.julday(d.year, d.month, d.day, 12.0)
            for name, body in [("Jupiter", swe.JUPITER), ("Saturn", swe.SATURN), ("Rahu", swe.MEAN_NODE)]:
                if len(found[name]) >= (1 if name == "Rahu" else 2):
                    continue
                lon = swe.calc_ut(jd, body, flags)[0][0]
                s_idx = int(lon // 30) % 12
                if s_idx != current_signs[name]:
                    house = (s_idx - chart.ascendant_sign_index) % 12 + 1
                    found[name].append((d, s_idx, house))
                    current_signs[name] = s_idx
                    
        if any(found.values()):
            lines.append("Upcoming major transits (Jupiter, Saturn, Rahu sign changes):")
            for name in ["Jupiter", "Saturn", "Rahu"]:
                for d, s_idx, house in found[name]:
                    month_yr = d.strftime("%b %Y")
                    lines.append(f"  - {name} enters {SIGNS[s_idx]} (your house {house}) around {month_yr}")
    except Exception:
        pass
    return lines


def _full_summary(self):
    """Rich summary for the AI: D1, dignities, lords, aspects, D9, dasha, transits, yogas."""
    lines = []

    # ── Data confidence (top of summary so the model hedges when needed) ──
    try:
        v = self.validate()
        if v["confidence"] != "high":
            lines.append(f"DATA CONFIDENCE: {v['confidence'].upper()}")
            for it in v["issues"]:
                lines.append(f"  ! ISSUE: {it}")
            for nt in v["notes"]:
                lines.append(f"  ~ CAVEAT: {nt}")
            lines.append("If confidence is LOW or MEDIUM, gently note that the "
                         "birth time should be confirmed before relying on exact "
                         "Lagna/Dasha timing. Do NOT present uncertain timing as fixed.")
            lines.append("")
    except Exception:
        pass

    lines += [self.summary(), ""]

    # ── Atmakaraka ──
    try:
        ak = _atmakaraka(self)
        if ak:
            lines.append(f"Atmakaraka (soul significator — planet with highest degree): "
                        f"{ak.name} at {ak.degree:.1f}° in {ak.sign} (House {ak.house})")
            lines.append("")
    except Exception:
        pass

    # ── House occupants (explicit grouping to prevent confusion) ──
    lines.append("House occupants (explicit — use this to know which planets share a house):")
    lines += [f"  - {t}" for t in _conjunctions(self)]
    lines.append("")

    # ── Comprehensive Dasha block ──
    try:
        import datetime as _dt3
        maha, antar, maha_end, antar_end = _vimshottari_periods(self)
        lords = self.house_lords_map()
        P = {p.name: p for p in self.planets}
        birth = _dt3.date.fromisoformat(self.date_of_birth)
        today = _dt3.date.today()

        def _planet_desc(name):
            p = P.get(name)
            if not p: return f"{name} (shadow planet — no house lordship)"
            h_list = [h for h, l in lords.items() if l == name]
            si = SIGNS.index(p.sign) if p.sign in SIGNS else -1
            dig = _dignity(name, si)
            dig_str = f", {dig}" if dig else ""
            retro = " [R]" if p.retrograde else ""
            if name in ("Rahu", "Ketu"):
                # Shadow planets have no house lordship
                sign_lord = SIGN_LORDS[si] if si >= 0 else "unknown"
                return (f"{name}{retro} — shadow planet, no house lordship, "
                       f"behaves like {sign_lord} (lord of {p.sign}), sits in H{p.house}")
            return f"{name}{retro} — lords H{h_list}, sits in H{p.house} ({p.sign}{dig_str})"

        dasha_rel = _dasha_relationship(maha, antar)
        lines.append("Vimshottari Dasha (ACCURATE — use these dates for all timing):")
        lines.append(f"  Mahadasha: {_planet_desc(maha)}, ends {maha_end.strftime('%b %Y')}")
        lines.append(f"  Antardasha: {_planet_desc(antar)}, ends {antar_end.strftime('%b %Y')}")
        lines.append(f"  Maha+Antar relationship: {dasha_rel}")

        # Full antardasha sequence for current Mahadasha
        # (critical for timing — Gemini must see all upcoming antardashas)
        lines.append(f"  Full antardasha sequence within {maha} Mahadasha:")
        a_idx = DASHA_ORDER.index(maha)
        # Find maha start date
        lord = NAK_DASHA_LORD[self.nakshatra_index]
        total_first = DASHA_YEARS[lord] * 365.25
        # CORRECT fraction: (moon_lon - nak_start) / nak_size
        _NAK_SIZE = 360.0 / 27.0
        _nak_start_lon = self.nakshatra_index * _NAK_SIZE
        _elapsed_frac = max(0.0, min((self.moon_longitude - _nak_start_lon) / _NAK_SIZE, 0.9999))
        elapsed_first = _elapsed_frac * total_first
        remaining_first = total_first - elapsed_first
        days_since_birth = (today - birth).days

        if days_since_birth <= remaining_first:
            maha_start_date = birth
            maha_span = remaining_first
        else:
            day_cursor = remaining_first
            idx = (DASHA_ORDER.index(lord) + 1) % 9
            maha_start_date = birth
            maha_span = 0.0
            while True:
                m2 = DASHA_ORDER[idx]
                span2 = DASHA_YEARS[m2] * 365.25
                if day_cursor + span2 > days_since_birth:
                    maha_start_date = birth + _dt3.timedelta(days=day_cursor)
                    maha_span = span2
                    break
                day_cursor += span2
                idx = (idx + 1) % 9
        days_into_maha = (today - maha_start_date).days
        at = 0
        for i in range(9):
            al = DASHA_ORDER[(a_idx + i) % 9]
            a_span = maha_span * DASHA_YEARS[al] / 120.0
            a_start = maha_start_date + _dt3.timedelta(days=at)
            a_end = maha_start_date + _dt3.timedelta(days=at + a_span)
            marker = " ← CURRENT" if at <= days_into_maha < at + a_span else ""
            h_list = [h for h, l in lords.items() if l == al]
            ap = P.get(al)
            ap_str = f"H{ap.house}" if ap else "N/A"
            if al in ("Rahu", "Ketu"):
                si2 = SIGNS.index(ap.sign) if ap and ap.sign in SIGNS else -1
                sl2 = SIGN_LORDS[si2] if si2 >= 0 else "?"
                lines.append(f"    {al} ({a_start.strftime('%b %Y')} → {a_end.strftime('%b %Y')}) "
                            f"shadow planet (behaves like {sl2}), sits {ap_str}{marker}")
            else:
                lines.append(f"    {al} ({a_start.strftime('%b %Y')} → {a_end.strftime('%b %Y')}) "
                            f"lords H{h_list}, sits {ap_str}{marker}")
            at += a_span

        # Pratyantardasha (sub-sub dasha) for current period
        try:
            at2 = 0.0
            _days_into_maha = (today - maha_start_date).days
            for i in range(9):
                al = DASHA_ORDER[(a_idx + i) % 9]
                a_span = maha_span * DASHA_YEARS[al] / 120.0
                if at2 <= _days_into_maha < at2 + a_span:
                    a_start = maha_start_date + _dt3.timedelta(days=at2)
                    lines.append(f"  Pratyantardasha (sub-sub dasha) within {al}:")
                    p_idx = DASHA_ORDER.index(al)
                    pt = 0.0
                    days_into_antar = _days_into_maha - at2
                    for j in range(9):
                        pl2 = DASHA_ORDER[(p_idx + j) % 9]
                        p_span = a_span * DASHA_YEARS[pl2] / 120.0
                        p_start = a_start + _dt3.timedelta(days=pt)
                        p_end = a_start + _dt3.timedelta(days=pt + p_span)
                        pm = " ← CURRENT" if pt <= days_into_antar < pt + p_span else ""
                        lines.append(f"    {pl2}: {p_start.strftime('%b %Y')} → {p_end.strftime('%b %Y')}{pm}")
                        pt += p_span
                    break
                at2 += a_span
        except Exception:
            pass
    except Exception as e:
        lines.append(f"  Dasha calculation error: {e}")
    lines.append("")
    # Explicit house → sign mapping (prevents Gemini from guessing)
    lines.append("House signs (Whole Sign system — each house sign is FIXED, do not guess):")
    for h in range(1, 13):
        s_idx = (self.ascendant_sign_index + h - 1) % 12
        lines.append(f"  - House {h} = {SIGNS[s_idx]}")
    lines.append("")

    # Functional nature of each planet for THIS lagna
    NATURAL_MALEFICS = {"Saturn", "Mars", "Rahu", "Ketu", "Sun"}
    NATURAL_BENEFICS = {"Jupiter", "Venus", "Moon", "Mercury"}
    lords = self.house_lords_map()
    lines.append(f"Functional nature of planets for {self.ascendant_sign} Lagna:")
    for planet in ["Sun","Moon","Mars","Mercury","Jupiter","Venus","Saturn","Rahu","Ketu"]:
        ruled = [h for h, l in lords.items() if l == planet]
        nat = "natural benefic" if planet in NATURAL_BENEFICS else "natural malefic"
        if planet in ("Rahu", "Ketu"):
            lines.append(f"  - {planet}: shadow planet ({nat}), rules no house, behaves like its sign lord")
        else:
            kendra = [h for h in ruled if h in (1,4,7,10)]
            trikona = [h for h in ruled if h in (1,5,9)]
            dusthana = [h for h in ruled if h in (6,8,12)]
            func = []
            if trikona: func.append(f"trikona lord (H{trikona})")
            if kendra: func.append(f"kendra lord (H{kendra})")
            if dusthana: func.append(f"dusthana lord (H{dusthana})")
            lines.append(f"  - {planet}: rules house(s) {ruled}, {nat}"
                        + (f", {', '.join(func)}" if func else ""))
    lines.append("")

    lines.append("House lords (Whole Sign) — lord name, where it sits, sign:")
    lines += [f"  - {t}" for t in self.house_lords_text()]
    lines.append("")
    lines.append("Planetary aspects — what each planet aspects (Vedic):")
    lines += [f"  - {t}" for t in _aspects_received(self)]
    lines.append("")
    lines.append("Aspects received by each house (USE THIS — never calculate aspects yourself):")
    lines += [f"  - {t}" for t in _aspects_on_houses(self)]
    lines.append("")
    lines.append("Mutual aspects between planets (both planets aspect each other):")
    mutual = _mutual_aspects(self)
    if mutual:
        lines += [f"  - {m}" for m in mutual]
    else:
        lines.append("  - None")
    lines.append("")
    lines.append("Planets in enemy signs (weakened — results come with effort or delay):")
    enemy = _enemy_signs(self)
    if enemy:
        lines += [f"  - {e}" for e in enemy]
    else:
        lines.append("  - None")
    lines.append("")
    lines.append("Navamsa (D9) positions with dignity (use for marriage/spouse/inner strength):")
    lines += [f"  - {t}" for t in self.navamsa_text()]
    lines.append("")
    lines.append("Dashamsha (D10) positions with dignity (PRIMARY chart for career/profession — "
                 "weigh this together with the 10th house and the current Dasha, not D1 alone):")
    lines += [f"  - {t}" for t in self.dashamsha_text()]
    lines.append("")
    lines.append("Supplemental divisional charts (supporting evidence only; never predict from these alone):")
    lines += [f"  - {t}" for t in self.supplemental_vargas_text()]
    # ── Graha Yuddha (planetary war) ──
    gy = _graha_yuddha(self)
    if gy:
        lines.append("")
        lines.append("Graha Yuddha (planetary war — combatants weakened):")
        lines += [f"  - {g}" for g in gy]

    # ── Jaimini Chara Karakas ──
    try:
        lines.append("")
        lines.append("Jaimini Chara Karakas (by degree — soul-level significators):")
        for abbr, name, p, desc in self.chara_karakas():
            lines.append(f"  - {abbr}: {name} ({p.degree:.2f}° in {p.sign}, H{p.house}) — {desc}")
    except Exception:
        pass

    # ── Advanced graded domain synthesis (CAREER / WEALTH / RELATIONSHIPS) ──
    for fn in (self.career_analysis, self.wealth_analysis, self.relationship_analysis):
        try:
            lines.append("")
            lines += fn()
        except Exception as e:
            lines.append(f"(domain analysis error: {e})")
    # ── Parivartana Yoga ──
    pari = _parivartana_yogas(self)
    if pari:
        lines.append("")
        lines.append("Parivartana Yogas (exchange of houses — very powerful):")
        lines += [f"  - {p}" for p in pari]

    # ── Vargottama ──
    varg = _vargottama(self)
    if varg:
        lines.append("")
        lines.append("Vargottama planets (same sign in D1 and D9 — exceptionally strong):")
        lines += [f"  - {v}" for v in varg]

    # ── Neecha Bhanga ──
    nb = _neecha_bhanga(self)
    if nb:
        lines.append("")
        lines.append("Debilitation status (Neecha / Neecha Bhanga):")
        lines += [f"  - {n}" for n in nb]

    # ── Mahapurusha Yogas ──
    mp = _mahapurusha_yogas(self)
    if mp:
        lines.append("")
        lines.append("Mahapurusha Yogas (rare — planet in own/exalted in kendra):")
        lines += [f"  - {m}" for m in mp]

    # ── Viparita Raj Yoga ──
    vr = _viparita_raj_yoga(self)
    if vr:
        lines.append("")
        lines.append("Viparita Raj Yoga (rise through adversity):")
        lines += [f"  - {v}" for v in vr]

    # ── Dhana Yogas ──
    dh = _dhana_yogas(self)
    if dh:
        lines.append("")
        lines.append("Dhana Yogas (wealth combinations):")
        lines += [f"  - {d}" for d in dh]

    # ── Standard yogas ──
    yg = _detect_yogas(self)
    if yg:
        lines.append("")
        lines.append("Other Yogas and Doshas:")
        lines += [f"  - {y}" for y in yg]
    lines.append("")
    lines += self.ashtakavarga_text()
    # ── Sade Sati / Dhaiya ──
    try:
        ss = _sade_sati_status(self)
        lines.append("")
        lines.append("Sade Sati / Dhaiya status (Saturn's transit phase relative to Moon):")
        lines += [f"  - {s}" for s in ss]
    except Exception:
        pass

    try:
        lines.append("")
        lines.append("Today's transits + aspects to your natal planets (ACCURATE — do not guess):")
        lines += [f"  - {t}" for t in _current_transits(
            self.ascendant_sign_index, SIGNS.index(self.moon_sign), self.planets)]
    except Exception:
        pass

    try:
        upcoming = _upcoming_transits(self)
        if upcoming:
            lines.append("")
            lines += upcoming
    except Exception:
        pass

    return "\n".join(lines)
BirthChart.full_summary = _full_summary




# ===========================================================================
# ASHTAKAVARGA — classical Parashari Bhinnashtakavarga + Sarvashtakavarga
# ===========================================================================
# For each planet, the benefic places (counted inclusively from each
# contributor's natal sign) where it gives a bindu. Contributors: the 7
# planets + Lagna. Standard BPHS tables.

ASHTAKAVARGA_TABLES = {
    "Sun": {"Sun": [1,2,4,7,8,9,10,11], "Moon": [3,6,10,11],
            "Mars": [1,2,4,7,8,9,10,11], "Mercury": [3,5,6,9,10,11,12],
            "Jupiter": [5,6,9,11], "Venus": [6,7,12],
            "Saturn": [1,2,4,7,8,9,10,11], "Lagna": [3,4,6,10,11,12]},
    "Moon": {"Sun": [3,6,7,8,10,11], "Moon": [1,3,6,7,10,11],
             "Mars": [2,3,5,6,9,10,11], "Mercury": [1,3,4,5,7,8,10,11],
             "Jupiter": [1,4,7,8,10,11,12], "Venus": [3,4,5,7,9,10,11],
             "Saturn": [3,5,6,11], "Lagna": [3,6,10,11]},
    "Mars": {"Sun": [3,5,6,10,11], "Moon": [3,6,11],
             "Mars": [1,2,4,7,8,10,11], "Mercury": [3,5,6,11],
             "Jupiter": [6,10,11,12], "Venus": [6,8,11,12],
             "Saturn": [1,4,7,8,9,10,11], "Lagna": [1,3,6,10,11]},
    "Mercury": {"Sun": [5,6,9,11,12], "Moon": [2,4,6,8,10,11],
                "Mars": [1,2,4,7,8,9,10,11], "Mercury": [1,3,5,6,9,10,11,12],
                "Jupiter": [6,8,11,12], "Venus": [1,2,3,4,5,8,9,11],
                "Saturn": [1,2,4,7,8,9,10,11], "Lagna": [1,2,4,6,8,10,11]},
    "Jupiter": {"Sun": [1,2,3,4,7,8,9,10,11], "Moon": [2,5,7,9,11],
                "Mars": [1,2,4,7,8,10,11], "Mercury": [1,2,4,5,6,9,10,11],
                "Jupiter": [1,2,3,4,7,8,10,11], "Venus": [2,5,6,9,10,11],
                "Saturn": [3,5,6,12], "Lagna": [1,2,4,5,6,7,9,10,11]},
    "Venus": {"Sun": [8,11,12], "Moon": [1,2,3,4,5,8,9,11,12],
              "Mars": [3,5,6,9,11,12], "Mercury": [3,5,6,9,11],
              "Jupiter": [5,8,9,10,11], "Venus": [1,2,3,4,5,8,9,10,11],
              "Saturn": [3,4,5,8,9,10,11], "Lagna": [1,2,3,4,5,8,9,11]},
    "Saturn": {"Sun": [1,2,4,7,8,10,11], "Moon": [3,6,11],
               "Mars": [3,5,6,10,11,12], "Mercury": [6,8,9,10,11,12],
               "Jupiter": [5,6,11,12], "Venus": [6,11,12],
               "Saturn": [3,5,6,11], "Lagna": [1,3,4,6,10,11]},
}


def _bhinnashtakavarga(self, planet_name):
    """Bindus of one planet in each of the 12 signs (list index = sign idx)."""
    contrib_signs = {p.name: SIGNS.index(p.sign) for p in self.planets
                     if p.name not in ("Rahu", "Ketu")}
    contrib_signs["Lagna"] = self.ascendant_sign_index
    bindus = [0] * 12
    table = ASHTAKAVARGA_TABLES[planet_name]
    for contributor, places in table.items():
        base = contrib_signs[contributor]
        for place in places:
            bindus[(base + place - 1) % 12] += 1
    return bindus
BirthChart.bhinnashtakavarga = _bhinnashtakavarga


def _sarvashtakavarga(self):
    """Total bindus per sign across all 7 planets (sums to 337)."""
    sav = [0] * 12
    for planet in ASHTAKAVARGA_TABLES:
        for i, b in enumerate(self.bhinnashtakavarga(planet)):
            sav[i] += b
    return sav
BirthChart.sarvashtakavarga = _sarvashtakavarga


def _ashtakavarga_text(self):
    """Human/AI-readable Ashtakavarga analysis."""
    sav = self.sarvashtakavarga()
    lines = ["Sarvashtakavarga (SAV) bindus per house (avg 28; >30 strong, <25 weak):"]
    for h in range(1, 13):
        s_idx = (self.ascendant_sign_index + h - 1) % 12
        v = sav[s_idx]
        tag = " [STRONG]" if v >= 30 else " [WEAK]" if v < 25 else ""
        lines.append(f"  - House {h} ({SIGN_SHORT[s_idx]}): {v} bindus{tag}")

    # Each planet's bindus in its own natal sign (its functional strength)
    lines.append("Planet strength (own bindus in natal sign; >=5 strong, <=3 weak):")
    for p in self.planets:
        if p.name in ("Rahu", "Ketu"):
            continue
        b = self.bhinnashtakavarga(p.name)[SIGNS.index(p.sign)]
        tag = " [STRONG]" if b >= 5 else " [WEAK]" if b <= 3 else ""
        lines.append(f"  - {p.name} in house {p.house}: {b}/8 bindus{tag}")

    # Transit quality: Saturn & Jupiter's bindus in the signs they transit today
    try:
        import datetime as dt
        today = dt.date.today()
        jd = swe.julday(today.year, today.month, today.day, 12.0)
        flags = swe.FLG_SIDEREAL
        for name, body in [("Jupiter", swe.JUPITER), ("Saturn", swe.SATURN)]:
            lon = swe.calc_ut(jd, body, flags)[0][0]
            t_idx = int(lon // 30) % 12
            b = self.bhinnashtakavarga(name)[t_idx]
            quality = ("favourable" if b >= 5 else
                       "difficult" if b <= 3 else "mixed")
            house = (t_idx - self.ascendant_sign_index) % 12 + 1
            lines.append(f"Transit check: {name} now in {SIGNS[t_idx]} "
                         f"(your house {house}) has {b}/8 of its own bindus "
                         f"there -> this transit is {quality} for you")
    except Exception:
        pass
    return lines
BirthChart.ashtakavarga_text = _ashtakavarga_text


if __name__ == "__main__":
    c = calculate_chart_from_coords("1990-01-15", "10:30 AM", 28.6139,
                                    77.2090, "Asia/Kolkata", "New Delhi, India")
    print(c.summary())
    print("\n--- overview ---")
    print(c.overview_block())
    print("\n--- chart data ---")
    import json
    print(json.dumps(c.chart_data(), indent=2))
