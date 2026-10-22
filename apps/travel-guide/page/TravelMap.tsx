// The map: real OpenStreetMap tiles through Leaflet, which the original could
// not have (its panel was a sandboxed iframe that blocked every tile, so it
// fetched a static image agent-side and drew the outline itself). The country
// is outlined over the tiles and fitted to its main landmass; while looking
// around, the spots are pins. A tap anywhere offers "plan a trip here" and
// "what's around here", so the map is also a place picker.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { CountryMap, MapConfig, SpotView } from '../engine/types.ts';

export type MapPick = 'destination' | 'around';
export type MapMode = 'world' | 'country' | 'around';

const INK = '#2f5d8a';
const SPOT = '#c2571a';

export function TravelMap({ config, mode, map, spots, onPick, onSpot }: {
  config: MapConfig;
  mode: MapMode;
  map: CountryMap | null;
  spots: SpotView | null;
  onPick: (what: MapPick, lat: number, lon: number) => void;
  onSpot: (index: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const leaflet = useRef<L.Map | null>(null);
  const drawn = useRef<L.LayerGroup | null>(null);
  const handlers = useRef({ onPick, onSpot });
  handlers.current = { onPick, onSpot };

  // The map itself, once.
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { worldCopyJump: true, minZoom: 2 }).setView([25, 10], 2);
    L.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: config.maxZoom }).addTo(m);
    drawn.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap();
      const menu = L.DomUtil.create('div', 'tm-pick');
      const option = (label: string, what: MapPick) => {
        const button = L.DomUtil.create('button', 'tm-pick__btn', menu);
        button.type = 'button';
        button.textContent = label;
        L.DomEvent.on(button, 'click', (ev) => {
          L.DomEvent.stop(ev);
          m.closePopup();
          handlers.current.onPick(what, lat, lng);
        });
      };
      option('Plan a trip here', 'destination');
      option('What’s around here?', 'around');
      L.popup({ closeButton: false, className: 'tm-popup', offset: [0, -2] }).setLatLng(e.latlng).setContent(menu).openOn(m);
    });
    // The column it sits in changes width with the window and the layout.
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(box.current);
    leaflet.current = m;
    return () => {
      resize.disconnect();
      m.remove();
      leaflet.current = null;
      drawn.current = null;
    };
  }, [config.tileUrl, config.attribution, config.maxZoom]);

  // What is drawn: the country's outline, or the spots and where the user is.
  const drawKey = mode === 'country' ? `c|${map?.country}|${map?.outline?.length ?? 0}` : mode === 'around' ? `a|${spots?.place}|${spots?.index}|${spots?.total}|${spots?.origin}` : 'w';
  useEffect(() => {
    const group = drawn.current;
    if (!group) return;
    group.clearLayers();
    if (mode === 'country' && map) {
      if (map.outline) {
        const rings = map.outline.map((ring) => ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple));
        L.polygon(rings, { color: INK, weight: 2, fillColor: INK, fillOpacity: 0.08, interactive: false }).addTo(group);
      } else if (map.center) {
        L.circleMarker(map.center, { radius: 8, color: INK, fillColor: INK, fillOpacity: 0.5, interactive: false }).addTo(group);
      }
    }
    if (mode === 'around' && spots) {
      if (spots.origin) {
        L.circleMarker(spots.origin, { radius: 7, color: '#fff', weight: 3, fillColor: INK, fillOpacity: 1 }).bindTooltip(`Around ${spots.place}`).addTo(group);
      }
      spots.pins.forEach((pin, index) => {
        const current = index === spots.index;
        // Paths pass their clicks on to the map by default, which would open "plan a trip here" over the pin.
        L.circleMarker([pin.lat, pin.lon], { radius: current ? 11 : 7, color: '#fff', weight: 2, fillColor: SPOT, fillOpacity: current ? 1 : 0.6, bubblingMouseEvents: false })
          .bindTooltip(pin.name, { direction: 'top', permanent: current, className: 'tm-tip' })
          .on('click', (ev) => {
            L.DomEvent.stopPropagation(ev);
            handlers.current.onSpot(index);
          })
          .addTo(group);
      });
    }
  }, [drawKey]);

  // Where the view goes: to the subject, whenever the subject changes.
  const fitKey = mode === 'country' ? `c|${map?.country}` : mode === 'around' ? `a|${spots?.place}|${spots?.index}` : 'w';
  useEffect(() => {
    const m = leaflet.current;
    if (!m) return;
    if (mode === 'country' && map) {
      // The landmass box, not the administrative one (rings.primaryBbox); capped so Monaco is not a street map.
      if (map.bbox) m.flyToBounds([[map.bbox[0], map.bbox[1]], [map.bbox[2], map.bbox[3]]], { padding: [24, 24], maxZoom: 10, duration: 1.1 });
      else if (map.center) m.flyTo(map.center, 5, { duration: 1.1 });
    } else if (mode === 'around' && spots) {
      const here = spots.spot ? ([spots.spot.lat, spots.spot.lon] as L.LatLngTuple) : null;
      if (here && spots.origin) m.flyToBounds([spots.origin, here], { padding: [48, 48], maxZoom: 16, duration: 0.9 });
      else if (here) m.flyTo(here, 16, { duration: 0.9 });
      else if (spots.origin) m.flyTo(spots.origin, 14, { duration: 0.9 });
    } else if (mode === 'world') {
      m.setView([25, 10], 2);
    }
  }, [fitKey]);

  return <div ref={box} className="tm-map" role="region" aria-label="Travel map. Tap anywhere to plan a trip there or see what is around." />;
}
