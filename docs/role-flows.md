# Role flows (acceptance criteria)

Each role gets a different app. Nobody sees screens meant for another role.

| Role | Device | Lands on | Navigation | Never sees |
|---|---|---|---|---|
| **Officer** | Phone (PWA) | **My visits** `/visits` | Visits · New visit · Account | `/manage`, `/admin` |
| **Manager** | Desktop + phone | **Inventory operations** `/manage` | Inventory operations · Schedule · Reports · Account | Officer field app (`/visits/*`), `/admin` |
| **Admin** | Desktop + phone | **Administration** `/admin` (overview) | Administration · Users · Description library · Form & schemes · System · *Oversight → Inventory operations* | Officer field app (`/visits/*`) |
| **Landlord / tenant** | Any phone, no account | **Signing page** `/sign/<token>` | none | everything else |

## Officer — do the inspection
1. Sign in → **My visits** (today, this week).
2. Open a visit (or **New visit**: postcode lookup → property → scheme/type → rooms present).
3. Room by room: wide photo, **Mark all as good**, grade exceptions G/F/P/U/N/A, comment + stamped photo for F/P/U.
4. General schedule, meters, appliances, miscellaneous, notes.
5. **Review & sign off**: blockers cleared → officer (+ landlord/tenant if present) e-sign on the phone.
6. **Generate the SOC report** → **Done** (Issued seal, PDF).
7. Absent landlord/tenant → **Send signing link** (email / copy for SMS).

## Manager — run the team
1. Sign in → **Inventory operations** (week picker): KPIs vs paper baseline, officer workload, median minutes per SOC, needs action (Unacceptable items, reports awaiting landlord signature), **Export CSV**.
2. **Schedule**: all visits, filters, **Assign / reassign**, **Schedule visit** for an officer.
3. **Reports**: archive search (report number, address, postcode, UPRN), PDF, preview, property history.
4. Signing links: send / resend / revoke, see disputes raised by landlords.

## Admin — run the system
1. Sign in → **Administration** overview: users, system health, PDF queue, library, form version, recent audit.
2. **Users**: create, change role, deactivate, reset password (one-time display).
3. **Description library**: one-tap phrases per item.
4. **Form & schemes**: template summary (read-only), scheme display names (print on reports).
5. **System**: health, job queue, failures, audit log.
6. *Oversight*: read the Inventory operations dashboard.

## Landlord / tenant — check and sign
1. Open the emailed / texted link → report summary, items not marked Good with photos.
2. **Dispute** any item (officer is notified) and/or **Read the full report** (PDF).
3. Print name, finger signature, confirm → **I agree — sign now** → "Signed — thank you".
4. Expired / used / revoked links explain what to do next.
