// The map: real OpenStreetMap tiles through Leaflet (tinted to Yonder's
// palette in yonder.css). The country is outlined over the tiles and fitted
// to its main landmass, clear of the host's tile; while wandering, the sights
// are pins. A tap anywhere offers "plan a trip here" and "what's around
// here", so the map is also a place picker.
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { CountryMap, MapConfig, SpotView } from '../engine/types.ts';

export type MapPick = 'destination' | 'around';
export type MapMode = 'world' | 'country' | 'around';

// Yonder's palette (page/yonder.css): Leaflet paths take colours, not variables.
const SEA = '#0b4870';
const CORAL = '#f0677a';
const SUN = '#f2b234';

/** Whether to jump rather than fly: the user asked for less motion. */
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const m = L.map(box.current, { worldCopyJump: true, minZoom: 2, zoomControl: false }).setView([25, 10], 2);
    // Bottom right: the host's tile sits in the top corner.
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer(config.tileUrl, { attribution: config.attribution, maxZoom: config.maxZoom }).addTo(m);
    drawn.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng.wrap();
      const menu = L.DomUtil.create('div', 'yd-pick');
      const option = (label: string, what: MapPick) => {
        const button = L.DomUtil.create('button', 'yd-pick-btn', menu);
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
      L.popup({ closeButton: false, className: 'yd-popup', offset: [0, -2] }).setLatLng(e.latlng).setContent(menu).openOn(m);
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
        L.polygon(rings, { color: SEA, weight: 2.5, fillColor: SUN, fillOpacity: 0.22, interactive: false }).addTo(group);
      } else if (map.center) {
        L.circleMarker(map.center, { radius: 9, color: SEA, weight: 3, fillColor: SUN, fillOpacity: 1, interactive: false }).addTo(group);
      }
    }
    if (mode === 'around' && spots) {
      if (spots.origin) {
        L.circleMarker(spots.origin, { radius: 7, color: '#fff', weight: 3, fillColor: SEA, fillOpacity: 1 }).bindTooltip(`Around ${spots.place}`).addTo(group);
      }
      spots.pins.forEach((pin, index) => {
        const current = index === spots.index;
        // Paths pass their clicks on to the map by default, which would open "plan a trip here" over the pin.
        L.circleMarker([pin.lat, pin.lon], { radius: current ? 11 : 7, color: '#fff', weight: current ? 3 : 2, fillColor: current ? CORAL : SEA, fillOpacity: current ? 1 : 0.75, bubblingMouseEvents: false })
          .bindTooltip(pin.name, { direction: 'top', permanent: current, className: 'yd-tip' })
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
    const jump = still();
    // Room for the host's tile (top right) and the place plate (bottom left).
    const width = m.getSize().x;
    const room = { paddingTopLeft: [24, 24] as L.PointTuple, paddingBottomRight: [Math.min(Math.round(width * 0.34), 290), 96] as L.PointTuple };
    const fit = (bounds: L.LatLngBoundsExpression, maxZoom: number, duration: number) => (jump ? m.fitBounds(bounds, { ...room, maxZoom, animate: false }) : m.flyToBounds(bounds, { ...room, maxZoom, duration }));
    const go = (at: L.LatLngExpression, zoom: number, duration: number) => (jump ? m.setView(at, zoom, { animate: false }) : m.flyTo(at, zoom, { duration }));
    if (mode === 'country' && map) {
      // The landmass box, not the administrative one (rings.primaryBbox); capped so Monaco is not a street map.
      if (map.bbox) fit([[map.bbox[0], map.bbox[1]], [map.bbox[2], map.bbox[3]]], 10, 1.1);
      else if (map.center) go(map.center, 5, 1.1);
    } else if (mode === 'around' && spots) {
      const here = spots.spot ? ([spots.spot.lat, spots.spot.lon] as L.LatLngTuple) : null;
      if (here && spots.origin) fit([spots.origin, here], 16, 0.9);
      else if (here) go(here, 16, 0.9);
      else if (spots.origin) go(spots.origin, 14, 0.9);
    } else if (mode === 'world') {
      m.setView([25, 10], 2);
    }
  }, [fitKey]);

  return <div ref={box} className="yd-map" role="region" aria-label="Map. Tap anywhere to plan a trip there, or to see what is around." />;
}
