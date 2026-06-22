# AI Astrologer Chat Module - Updated Fixes

Target app shape: `D:\veshannastro\veshannastro-updated`.

## Latest fixes

- Added backend `/api/places` for worldwide place search using OpenStreetMap/Nominatim.
- Place search is user-triggered with caching/throttling, not live autocomplete.
- Place selection now stores exact latitude, longitude, and timezone before setup can continue.
- Fixed time parsing:
  - accepts `14:35`
  - accepts `2:35 PM`
  - accepts `2 PM`
  - rejects impossible/bad time text
  - keeps a clock picker button beside the input
- Replaced the simple rectangular chart with a North Indian-style Kundli SVG.
- The Kundli appears first, then the conversation begins.
- Credit UI now only shows credits left and renewal timing.
- Removed the extra before/deducted/after credit chat note from the user view.

## Free place-search note

Google Maps/Places is not truly free for unlimited production usage. This build uses OpenStreetMap/Nominatim instead. Public Nominatim must be used politely: user-triggered searches, caching, attribution, and low request rate.

## Verified

- `node --check widget.js` passed.
- Python syntax check passed for `server.py`, `database.py`, `credits_payments.py`, `ai.py`, and `astrology.py`.
