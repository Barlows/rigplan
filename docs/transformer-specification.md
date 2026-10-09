# Transformer specification — Line 5

Two units, one feeding PDB7 (MSB9) and one feeding PDB8 (MSB8), both from MVSB1.
This is the document that goes on the enquiry. Where it quotes a number that the
project currently *assumes*, it says so, and it says what would change it.

---

## 1. Rating — settled, and it does not wait for anything

| | |
|---|---|
| Quantity | 2 |
| Rating | 3,150 kVA each |
| Installed | 6,300 kVA |

The load this has to carry, stated two ways, because a load schedule supports
both and applying both would be wrong:

| Method | Across the site | Against 6,300 kVA |
|---|---|---|
| Per-circuit demand factors (the stated method) | 4,172 kVA | 66% |
| Coincidence, "repetitive plant" band 0.60 | 6,015 kVA | 95% |
| Connected load, no diversity | 9,529 kW / 10,037 kVA | 159% |

**The rating is 3,150 kVA per unit and the order does not depend on which of the
first two methods is right.** The tightest bracket puts both transformers at 95%
at design load — 61% on TX8 and 71% on TX7 — which is high but is the honest
consequence of the conservative band, and it is the number to commission
against. The connected figure is not a design case; it is the load with every
machine running and every coincidence in the plant in the wrong place.

**This does change if the demand factors are wrong.** The per-circuit factors on
PDB8 sum to 0.30 of connected, with 32 of 63 circuits below 0.35 and the lowest
at 0.10. That is a real claim about a plant of drive panels and it is the one
assumption the rating rests on. Confirm it against measured data before
commissioning. It does not hold up the order — the bracket above shows why — but
it does change how hard each transformer runs.

## 2. Voltage and vector group

| | |
|---|---|
| LV | 415 V, 3-phase, 4-wire |
| Vector group | **Dyn11** |
| System | TN-S |

| HV | **11 kV — confirmed.** MVSB1 is the main switchboard supplying TX7 and TX8. |

Dyn11 is confirmed by the site data. It is also the right choice and not a
detail — a star winding on the HV gives a separate neutral for the earthing
arrangement that TN-S requires, and brings the LV neutral out as its own
conductor rather than bonded.

## 3. Percent impedance — the one number this document decides

**Specified: 6.0% on base rating at rated power, tolerance ±10% to IEC 60076.**

It is not on a nameplate anywhere, so the answer is to specify the band rather
than to discover it later. The band is derived from the switchgear, which is the
only thing it constrains:

| %Z | Fault at 415 V | Incomer device required | NSX range |
|---|---|---|---|
| 4% | 109 kA | 136 kA | **nothing in the range** |
| 5% | 88 kA | 110 kA | **nothing in the range** |
| **6%** | **74 kA** | **92 kA** | **100 kA — yes** |
| 7% | 63 kA | 79 kA | 100 kA — yes |
| 8% | 56 kA | 70 kA | 100 kA — yes |
| 10% | 45 kA | 56 kA | 100 kA — yes |

The margin applied is 1.25 on the fault level, and the NSX range tops out at
100 kA. So **any transformer below about 5.6% cannot be switched by the devices
this design calls for**, and at 4–5% the answer is not a larger frame — it is a
fuse at the transformer or a different source impedance.

Specifying 6% ±10% therefore puts the delivered fault level between 63 and
88 kA and every one of them inside the 100 kA incomers. It is the middle of the
range a distribution transformer of this size normally comes in at, so it should
cost nothing to obtain.

**Both units must have the same impedance, within 5% of each other.** They share
an LV switchboard and either may have to carry both boards during maintenance; if
their impedances differ, the load divides in inverse proportion and one unit runs
hard while the other runs light. It also moves the circulating current between
them if they are ever paralleled. State it as a requirement.

## 4. Tap

| | |
|---|---|
| Type | On-load, HV side, ±3 × 2.5% (seven positions, ±7.5%) |
| Delivered at | Mid-position |
| To commission at | **+5% on both** |

The commissioning position is not a guess — it is calculated. At nominal tap the
far end of this installation sits 5.4–6.2% below nominal on TX7 and 4.8–6.1% on
TX8, because the transformers drop 4.2–4.9% across their own impedance. The
cables are not the problem: the wiring drop everywhere is 0.54% to 1.86% against
a 5% limit. **+5% on both brings every one of the 97 circuits inside the limit
and holds the supply terminals at 100.1–100.8% of nominal at the same time**,
which is the check that the position is right rather than merely adequate.

Set it against measured voltage at the far end, not by calculation alone — the
4.2–4.9% transformer drop assumes 6%, which is what section 3 specifies.

## 5. Cooling and enclosure

| | |
|---|---|
| Cooling | ONAN / ONAF, fans as required for the rating |
| Winding temperature rise | 65/75 K (AN / AF) |
| Core | 75 K |
| Ambient | **40 °C rated** |
| Enclosure | To suit MVSB1's switchroom |
| Protection class | To suit, minimum IP20 indoors |

**The 40 °C ambient is not a formality.** Every cable on this project is
derated for 40 °C ambient, and a transformer specified for the standard 25 °C
loses roughly 3% of its rating in a switchroom at 40 °C. If the ambient is
actually 35 °C the allowance is smaller and if the plant runs hot it is larger;
either way the rating has to be quoted at the ambient the transformer will see.

## 6. Protection

Each unit requires, as a minimum:

- **Buchholz gas relay** and gas-temperature alarm on the HV winding
- **Oil temperature indicator** with alarm and trip contacts
- **Pressure relief device** with a Buchholz trip
- **Cooling-fan failure alarm**, and an alarm on any temperature or gas alarm
- **LV neutral brought out to a separate terminal** — TN-S, not bonded inside
  the transformer
- **Core earthing** — a single core bonded to a dedicated earth bar, one per
  transformer, so a core fault current has a defined path

HV protection is an MV switchgear matter and is assumed to be fuse or relay at
MVSB1. **If it is fuse-protected, the transformer's inrush decides the fuse**,
and 3,150 kVA at 11 kV draws a large inrush for a few cycles — a 3,150 kVA unit
is typically 5–8× rated current for 50–100 ms. Coordinate it, or specify a
switch-fuse unit sized for it rather than a fixed fuse.

## 7. What is being asked for

Quote each unit separately, and quote the **impedance band and the tolerance** as
a requirement rather than a figure to be met later. State on the quotation:

- Rated power, HV and LV, vector group
- **Short-circuit impedance at base rating, and the tolerance on it**
- Vector group and neutral arrangement
- Tap range, positions, and the type — on-load or off-circuit
- Losses: iron and copper at full load, and no-load
- Impedance voltage at a second temperature if stated
- Cooling class and ambient temperature the rating is quoted at
- Paralleling data: impedance, ratio and vector group, for matching
- Test certificate per IEC 60076-2, including the measured impedance

The measured impedance on the test certificate is the number that closes the last
open item on this project. Everything downstream of it — the Icu column on the
whole switchgear schedule, the busbar short-time withstand, the cable sizes —
stays indicative until it arrives.

## 8. What this specification decides, and what it does not

**Decides:** the rating (3,150 kVA each), the impedance band (6% ±10%, which is
what makes the 100 kA incomers viable), the tap range and commissioning
position (+5%), the vector group, cooling, and the protection.

**Does not decide:** the measured impedance on the test certificate, which is
what turns the fault levels from indicative into facts.

---

## 9. Why the 6% does not need to be known before the order

The 6% is the transformer's own percent impedance — its voltage drop at rated
current with the secondary shorted. It is on the nameplate and on the test
certificate. **It is not the whole impedance**, because the 11 kV network is in
series with it, and that is worth saying plainly because it removes the urgency:

| Network fault level at MVSB1 | Referred to 415 V | Total impedance | Fault level at the busbar |
|---|---|---|---|
| — (transformer alone) | — | 3.280 mΩ | **73.0 kA** |
| 1,000 MVA | 0.172 mΩ | 3.453 mΩ | 69.4 kA |
| 500 MVA | 0.344 mΩ | 3.625 mΩ | 66.1 kA |
| **250 MVA** | 0.689 mΩ | 3.969 mΩ | **60.4 kA** |
| 150 MVA | 1.148 mΩ | 4.429 mΩ | 54.1 kA |
| 100 MVA | 1.722 mΩ | 5.003 mΩ | 47.9 kA |

**Every one of those is below the 73 kA this design assumes.** The network can
only add impedance, never remove it, so the transformer-only figure is the
highest fault level consistent with a 6% transformer — and everything this
project sizes against is therefore conservative in the safe direction. The
100 kA incomers carry more margin than quoted, the busbar requirement of 92 kA
is more demanding than the real fault, and the cables are sized for at least the
current they must survive.

It also makes the low-impedance case in section 3 much less likely to bite. With
a 250 MVA network, a 4% transformer gives 83 kA rather than 110 kA — still
inside 100 kA. Only a stiff network *and* a low impedance together put the
switchgear in trouble, which is why specifying 6% ±10% is comfortable rather
than merely conventional.

**So the order does not wait for the impedance.** Ask MVSB1's owner for the
network fault level at the outgoing way when convenient; it sharpens the numbers
and it settles the busbar's short-time withstand, but nothing in this
specification is provisional on it.