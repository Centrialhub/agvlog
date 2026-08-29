import { useEffect } from "react";
import { useMap } from "react-leaflet";

import { L } from "@/lib/maps/leaflet";

export function MapAutoFit({
  points,
  padding = 40,
  maxZoom = 13,
  singlePointZoom,
}: {
  points: [number, number][];
  padding?: number;
  maxZoom?: number;
  singlePointZoom?: number;
}): null {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1 && singlePointZoom != null) {
      map.setView(points[0], singlePointZoom);
      return;
    }
    map.fitBounds(L.latLngBounds(points), {
      padding: [padding, padding],
      maxZoom,
    });
  }, [map, maxZoom, padding, points, singlePointZoom]);

  return null;
}
