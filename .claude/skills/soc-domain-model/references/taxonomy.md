# Item taxonomy

## 1. Exact rooms and items in `SOC TEMPLATE (PLS).docx` — AUTHORITATIVE (document order, spelling as in source; 15 rooms, 264 rows, 64 item types)
Every item row offers condition G / F / P. Columns: ITEM · Qty · DESCRIPTION · CONDITION · COMMENT · SCHEDULE OF DILAPIDATION.

- **FRONT GARDEN**: BOUNDARY, GATE, OFF STREET PARKING, LAWN, BORDERS, PATH
- **BACK GARDEN**: BOUNDARY, PATIO, LAWN, SHED, GARAGE
- **FRONT DOOR**: PORCH, DOOR, DOOR FRAME, DOOR BELL, KNOCKER, SPY HOLE, NUMERALS, LETTERBOX, LIGHT, Locks
- **HALLWAY**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, RADIATOR, CUPBOARD, SINGLE SOCKET, DOUBLESOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, TELEPHONE SOCKET, CABLE BOX, SMOKE ALARM, AERIAL, INTERCOM, ALARM, LIGHT FITTING
- **RECEPTION**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOWHANDLE, RADIATOR, PATIO DOORS, CUPBOARD, DOUBLE SOCKET, SINGLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, TELEPHONE SOCKET, CABLE BOX, SMOKE ALARM, AERIAL, INTERCOM, ALARM, LIGHT FITTING
- **CONSERVATORY**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, CUPBOARD, DOUBLE SOCKET, SINGLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, TELEPHONE SOCKET, CABLE BOX, SMOKE ALARM, AERIAL, ALARM, LIGHT FITTING
- **KITCHEN**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, BACK DOOR, BASE UNITS SINGLE, BASE UNITS DOUBLE, WALL UNITS SINGLE, WALL UNITS DOUBLE, CORNER WALL UNITS, WORK SURFACE, SINK, TAP, BACKSPLASH, OVEN, HOB, GRILL, EXTRACTOR, BOILER, SINGLE SOCKET, DOUBLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, COOKER SWITCH, SMOKE ALARM, ALARM, LIGHT FITTING
- **UTILITY**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, BACK DOOR, BASE UNITS SINGLE, BASE UNITS DOUBLE, WALL UNITS SINGLE, WALL UNITS DOUBLE, WORK SURFACE, SINK, TAP, BACKSPLASH, BOILER, SINGLE SOCKET, DOUBLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH
- **STAIRS AND LANDING**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, BANISTER, HANDRAIL, WINDOW, WINDOW HANDLE, RADIATOR, CUPBOARD, SINGLE SOCKET, DOUBLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, TELEPHONE SOCKET, CABLE BOX, SMOKE ALARM, ALARM, LIGHT FITTING
- **BEDROOM 1–4** (identical): WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, DOUBLE SOCKET, SINGLE SOCKET, SINGLE LIGHT SWITCH, DOUBLE LIGHT SWITCH, TELEPHONE SOCKET, CABLE BOX, SMOKE ALARM, AERIAL, LIGHT FITTING
- **BATHROOM**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, BATH, BATH TAPS, SHOWER, SINK, WATER CLOSET, BATHROOM FITTINGS, CUPBOARD, MIRROR, SINGLE /PULL LIGHT SWITCH, SMOKE ALARM, LIGHT FITTING
- **SEPARATE WC**: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, WATERCLOSET, SINK, BATHROOMFITTINGS, LIGHTFITTING
- **MISCELLANEOUS**: 13 blank rows

Note: flooring is not an item row in the template (it appears in the report's general schedule and the description library) — decide with officers whether it becomes a per-room item.

## 2. Appendix A — de-duplicated taxonomy (PROPOSAL only; where it differs from §1, §1 wins)
| Room type | Count | Items |
|---|---|---|
| Front / back garden | 7 | Boundary · Gate · Off-street parking · Lawn · Borders · Path · Patio · Shed · Garage |
| Front door | 10 | Porch · Door · Door frame · Door bell · Knocker · Spy hole · Numerals · Letterbox · Light · Locks |
| Hallway / stairs and landing | 21 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Banister · Handrail · Window · Window handle · Radiator · Cupboard · Single socket · Double socket · Single light switch · Double light switch · Telephone socket · Cable box · Smoke alarm · Intercom · Alarm · Light fitting |
| Reception / conservatory | 22 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Window · Window handle · Radiator · Patio doors · Cupboard · Single socket · Double socket · Single light switch · Double light switch · Telephone socket · Cable box · Smoke alarm · Aerial · Intercom · Alarm · Light fitting |
| Kitchen | 32 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Window · Window handle · Radiator · Back door · Base units single · Base units double · Wall units single · Wall units double · Corner wall units · Work surface · Sink · Tap · Backsplash · Oven · Hob · Grill · Extractor · Boiler · Single socket · Double socket · Single light switch · Double light switch · Cooker switch · Smoke alarm · Alarm · Light fitting |
| Utility | 23 | As kitchen, without oven, hob, grill, extractor and cooker switch |
| Bedroom (1–4) | 18 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Window · Window handle · Radiator · Single socket · Double socket · Single light switch · Double light switch · Telephone socket · Cable box · Smoke alarm · Aerial · Light fitting |
| Bathroom | 20 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Window · Window handle · Radiator · Bath · Bath taps · Shower · Sink · Water closet · Bathroom fittings · Cupboard · Mirror · Single/pull light switch · Smoke alarm · Light fitting |
| Separate WC | 13 | Walls · Ceiling · Door · Handle · Door frame · Woodwork · Window · Window handle · Radiator · Water closet · Sink · Bathroom fittings · Light fitting |
| Miscellaneous | 13 blank | Free rows; the queue of candidates to add to the taxonomy |

(Appendix A's stated counts don't always match the listed items, e.g. garden says 7 but lists 9 — recount when agreeing.)

## 3. Prototype item sets (simplified demo only — NOT to be used as the form; `Inventory App Prototype.dc.html`)
- garden: BOUNDARY, GATE, LAWN, BORDERS, PATH, PATIO, SHED
- frontdoor: PORCH, DOOR, DOOR FRAME, DOOR BELL, SPY HOLE, NUMERALS, LETTERBOX, LIGHT, LOCKS
- hall: WALLS, CEILING, DOOR, HANDLE, DOOR FRAME, WOODWORK, RADIATOR, CUPBOARD, SINGLE SOCKET, DOUBLE SOCKET, LIGHT SWITCH, SMOKE ALARM, INTERCOM, LIGHT FITTING
- reception: WALLS, CEILING, DOOR, HANDLE, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, PATIO DOORS, DOUBLE SOCKET, SINGLE SOCKET, LIGHT SWITCH, AERIAL, SMOKE ALARM, LIGHT FITTING
- kitchen: WALLS, CEILING, DOOR, WINDOW, RADIATOR, BASE UNITS, WALL UNITS, WORK SURFACE, SINK, TAP, BACKSPLASH, OVEN, HOB, EXTRACTOR, BOILER, COOKER SWITCH, SMOKE ALARM, LIGHT FITTING
- stairs: WALLS, CEILING, BANISTER, HANDRAIL, WOODWORK, WINDOW, RADIATOR, CUPBOARD, LIGHT SWITCH, SMOKE ALARM, LIGHT FITTING
- bedroom: WALLS, CEILING, DOOR, HANDLE, WOODWORK, WINDOW, WINDOW HANDLE, RADIATOR, DOUBLE SOCKET, LIGHT SWITCH, AERIAL, SMOKE ALARM, LIGHT FITTING
- bathroom: WALLS, CEILING, DOOR, WINDOW, RADIATOR, BATH, BATH TAPS, SHOWER, SINK, WATER CLOSET, BATHROOM FITTINGS, MIRROR, EXTRACTOR, LIGHT FITTING
- wc: WALLS, CEILING, DOOR, WINDOW, WATER CLOSET, SINK, LIGHT FITTING

The 3-bed house demo totals 141 items. Item keys in the prototype are `ROOM|ITEM`; state persisted to localStorage key `kingston-soc-prototype-v1`.
