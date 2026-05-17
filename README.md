# SunPower Panel Card for Home Assistant

A custom Lovelace card that displays per-panel solar production from a SunPower PVS6 system, with color-coded status tiles, historical production charts, drag-to-arrange layout, and a detail popup for each panel.

![SunPower Panel Card](https://img.shields.io/badge/version-3.9.2-orange) ![HA](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-blue)

---

## Features

- **Per-panel monitoring** — live wattage, today's kWh, and temperature for each inverter
- **Color-coded tiles** — grey (offline) → amber → orange (peak production)
- **Sparkline graphs** — today's production curve on every tile
- **Detail popup** — click any panel for full metrics: MPPT voltage/amps, frequency, voltage, amps
- **Production history charts** — Day / Week / Month / Year / Lifetime / Custom range
- **Period navigation** — ← → arrows to browse previous days, weeks, months, years
- **Hover tooltips** — hover over any bar to see exact kWh for that period
- **Roof layout arrange** — drag panels to match their physical position on your roof
- **Persistent layout** — arrangement saved to HA server, survives browser cache clears
- **Snap-to-grid** — click a panel to select it, click any slot to move it
- **Auto-extending grid** — empty rows appear automatically for flexible layouts
- **Offline detection** — red pulsing dot for unavailable/disconnected panels
- **Scroll-safe** — uses smart re-render to prevent page scroll reset on data updates

---

## Requirements

### Hardware
- SunPower PVS6 supervisor (one microinverter per panel)

### Home Assistant Integrations (install via HACS)
- **Enhanced SunPower** — [`smcneece/ha-esunpower`](https://github.com/smcneece/ha-esunpower)
  - This integration creates one device per inverter with entities for Power, Lifetime Power, Temperature, Voltage, Amps, MPPT data, etc.

### Entity naming
The card auto-detects inverters using this exact pattern:
```
sensor.inverter_E<14 digits>_power
```
Example: `sensor.inverter_e00122251234567_power`

If your entities follow this pattern, the card works with zero configuration.

---

## Installation

### Step 1 — Download the card

Download `sunpower-panel-card.js` from this repository and place it in:
```
config/www/sunpower-panel-card.js
```

Using the HA File Editor add-on: navigate to `/config/www/` and upload the file. If the `www` folder doesn't exist, create it first.

### Step 2 — Register as a Lovelace resource

Go to **Settings → Dashboards → ⋮ (three dots top right) → Resources → Add Resource**

| Field | Value |
|-------|-------|
| URL | `/local/sunpower-panel-card.js?v=1` |
| Resource type | JavaScript Module |

Then **restart Home Assistant** (Settings → System → Restart).

> **Important:** Every time you update the card file, increment the `?v=` number (e.g. `?v=2`, `?v=3`) to force browsers to load the new version.

### Step 3 — Add to your dashboard

Edit any dashboard → **Add Card → Manual** and paste:

```yaml
type: custom:sunpower-panel-card
title: Solar Panels
columns: 4
max_watts: 400
```

The card will auto-detect all your inverter entities and display them immediately.

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | `Solar Panels` | Card title displayed in the header |
| `columns` | number | `4` | Number of panel columns (match your widest roof row) |
| `max_watts` | number | `400` | Rated capacity per panel in watts (check your spec sheet) |

### Example with all options

```yaml
type: custom:sunpower-panel-card
title: My Solar Array
columns: 4
max_watts: 420
```

---

## Using the Card

### Main View

The card shows all panels as tiles with:
- **Serial number** (last 10 digits) in the top-left
- **Current wattage** in large text
- **Production bar** showing % of rated capacity
- **Sparkline** of today's production curve
- **Today's kWh** accumulated production
- **Temperature** in °F

**Header chips** always show:
- `X/X online` — active panels vs total
- `X.XX kW now` — current total system output
- `↑ XX.XX kWh today` — today's total production across all panels

### Panel Detail Popup

Click any panel tile to open a detail sheet with:

- Full inverter serial number
- Current wattage, period total, and online/offline status
- Temperature, MPPT Voltage, MPPT Amps, Voltage, Amps, Frequency
- Production history chart for the selected time range
- Period selector: **Day / Week / Month / Year / Lifetime / Custom**
- ← → navigation to browse previous periods
- Hover over any bar to see exact kWh for that time bucket
- Tap the overlay background or ✕ button to close

### Arrange Mode

Click **⠿ Arrange** in the top-right corner to enter arrange mode.

**How to move panels:**
1. Click a panel tile — it gets an orange outline (selected)
2. Click any other panel or empty slot — the selected panel moves there (swap)
3. Empty rows auto-extend as you move panels downward
4. Click **✓ Done** to save the arrangement

**Reset** — click the red **↺ Reset** button at the bottom of the arrange view to restore the default serial-sorted order.

**Layout persistence** — your arrangement is saved to HA's server storage and survives:
- Browser cache clears
- Hard refreshes
- Different browsers on the same HA account
- HA restarts

### Time Range Selector (in popup)

| Period | Bars represent | Navigation |
|--------|---------------|------------|
| Day | kWh per hour (24 bars) | ← previous day / → next day |
| Week | kWh per day (7 bars, Sun–Sat) | ← previous week |
| Month | kWh per day (28–31 bars) | ← previous month |
| Year | kWh per month (12 bars) | ← previous year |
| Lifetime | kWh per year (up to 15 years) | No navigation |
| Custom | kWh per day (date range picker) | Select start and end dates |

> **Note:** Week/Month/Year/Lifetime data comes from HA's long-term statistics — available from when Enhanced SunPower was first installed, not limited by recorder retention.

---

## Troubleshooting

### No panels detected
The card shows "No inverters found" — check that:
1. Enhanced SunPower integration is installed and configured
2. Your inverter entities follow the pattern `sensor.inverter_E<14digits>_power`
3. At least one inverter entity is in state `on` or reporting a numeric value

Open the browser console and look for:
```
SunPower Panel Card  v3.9.2 — 19 inverters
```
If you see `0 inverters`, your entity IDs don't match the expected pattern.

### Card shows old version after update
Change the resource URL version number: `/local/sunpower-panel-card.js?v=2` → `?v=3`

Then go to **Settings → System → Restart** for a full HA restart, followed by a hard browser refresh (Ctrl+Shift+R).

### Layout resets after browser cache clear
This should not happen with v3.9.2+ — the layout is stored in HA's server. If it does reset, click Arrange and re-save to write the arrangement to HA's storage.

### History shows no data for older periods
- Week/Month/Year use HA's long-term statistics recorder. These are created automatically once Enhanced SunPower is installed and HA has been running for some time.
- The Lifetime view shows up to 15 years of monthly averages.
- If you see no bars for week/month, wait 24–48 hours after installing Enhanced SunPower — HA needs time to accumulate statistics.

### Production values seem wrong
The Enhanced SunPower integration reports power in **kW** — the card converts to **W** automatically. If values look 1000× too small or too large, check your `max_watts` setting matches your panel's rated capacity.

---

## Compatible Hardware

Tested with:
- SunPower PVS6 supervisor
- AC Module Type H microinverters (one per panel)

Should work with any SunPower system where Enhanced SunPower creates entities in the `sensor.inverter_E<serial>_power` format.

---

## Related Integrations & Cards

These were also used in the author's setup alongside this card:

| Name | Purpose |
|------|---------|
| [Enhanced SunPower](https://github.com/smcneece/ha-esunpower) | Per-inverter entity data |
| [Solcast PV Forecast](https://github.com/BJReplay/ha-solcast-solar) | Solar production forecast |
| [Power Flow Card Plus](https://github.com/flixlix/energy-flow-card-plus) | System-level energy flow visualization |
| [ApexCharts Card](https://github.com/romrider/apexcharts-card) | Advanced charting for system totals |

---

## Version History

| Version | Highlights |
|---------|-----------|
| 3.9.2 | HA server storage for layout persistence — survives all browser clears |
| 3.9.0 | IndexedDB persistence (superseded by 3.9.2) |
| 3.8.0 | `slot_grid` config field approach (superseded) |
| 3.7.0 | Detail panel moved to bottom-sheet modal popup |
| 3.5.0 | kWh production charts replacing avg-watt charts |
| 3.4.0 | Y-axis labels on production chart |
| 3.3.0 | Snap-to-grid arrange with auto-extending empty rows |
| 3.0.0 | Full snap-to-grid rewrite, localStorage + config persistence |
| 2.0.0 | HA statistics WebSocket API, period navigation, custom range |
| 1.4.0 | Light theme, 24h timeline, period history buttons |
| 1.0.0 | Initial release |

---

## License

MIT License — free to use, modify, and share.

---

## Credits

Built for a SunPower residential solar installation in Texas.
Developed iteratively with real inverter data from a PVS6 system with 19 AC Module Type H panels.
