export type City = {
  id: number;
  cityCode: string;
  name: string;
};

export type StopPoint = {
  stopId: number;
  stopCode: string | null;
  stopName: string;
  lat: number;
  lon: number;
};

export type RouteLine = {
  routeId: number;
  agencyId: number | null;
  agencyName: string | null;
  lineName: string;
  shortName: string | null;
  longName: string | null;
  color: string;
  points: [number, number][];
  /** "shape" when points come from shapes.txt, "stops" when reconstructed from the stop sequence. */
  geometry: "shape" | "stops";
  stopIds: number[];
  tripsCount: number;
  stopEvents: number;
  routeScore: number;
  routeCategory: "core" | "secondary" | "local";
};

export type CityGtfsPayload = {
  city: City;
  stops: StopPoint[];
  routes: RouteLine[];
};
