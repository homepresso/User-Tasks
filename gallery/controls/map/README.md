# Map

`<ut-map>` — an OpenStreetMap map (Leaflet) that shows a location from another field and,
optionally, lets people drop a pin.

## Value

Type `json`: `{ "lat": number, "lng": number }` (latitude −90…90, longitude −180…180, six decimals),
or empty (`null`). With **Let people drop a pin** off the control never changes the value: it only
shows the mapped location. Read-only views (completed tasks, emails, mobile) show
`-36.844149, 174.76716`; on the form, read-only shows the map with the pin and no picking.

## Properties

| Property | Type | Default | |
|---|---|---|---|
| Map style (`tiles`) | OpenStreetMap, dimmed in dark mode / OpenStreetMap, always light | dimmed in dark mode | |
| Zoom (`zoom`) | number 1–19 | 15 | Zoom used when the map centres on a location |
| Map height (`height`) | number 160–800 | 320 | px |
| Let people drop a pin (`pick`) | yes / no | no | Click / tap / drag the pin / Enter / the coordinate inputs set the value |
| Show coordinates (`show_coordinates`) | yes / no | yes | Latitude and longitude under the map (always editable inputs in pick mode) |

## Context

| Name | What to map | |
|---|---|---|
| `location` | An Address field (`{ lat, lng, … }`), `{ latitude, longitude }`, `{ lat, lon }` or `"lat,lng"` text | When it changes the map centres on it and shows the pin. In pick mode the new location also becomes the value (people can then fine-tune it). |

## Keyboard and screen readers

The map is an `application` region named by the field label plus the pin's coordinates. Tab to it:
arrow keys pan, `+` / `-` zoom (Leaflet's keyboard handling). In pick mode a crosshair marks the
centre while the map has keyboard focus and Enter or Space drops the pin there. The Latitude and
Longitude inputs (a "Coordinates" group) set the pin exactly, Clear removes it, and changes are
announced in a live region. Zoom buttons are 32 px. Animations are off with
`prefers-reduced-motion`.

## Capabilities

`network`, host `tile.openstreetmap.org` (an administrator approves it in Extensibility → Form
controls). Public tile servers refuse requests without a Referer, and a sandboxed frame (opaque
origin) never sends one, so the map asks the host for each tile (`tile` request): the UserTasks server
fetches it from OpenStreetMap with an identifying User-Agent and Referer, caches it, rate-limits per
user, and serves it only when the host is approved for this control. The frame draws it through a
`blob:` URL that is revoked as soon as the image has decoded. Until the host is approved the map shows
a plain background, the pin and "Map tiles are blocked until an administrator approves … (Extensibility →
Form controls)". Attribution ("© OpenStreetMap contributors") is always visible.

Bundles Lit 3.3.3 (BSD-3-Clause) and Leaflet 1.9.4 (BSD-2-Clause; its CSS is inlined in the shadow
root without the PNG images). The pin is an inline SVG.

## Notes

- OpenStreetMap's tile servers are a free, donation-funded service with a
  [usage policy](https://operations.osmfoundation.org/policies/tiles/): fine for light form traffic;
  for heavy use fork the control for a commercial or self-hosted tile server (CARTO's free basemaps need a known referrer, which a sandboxed frame never sends).
