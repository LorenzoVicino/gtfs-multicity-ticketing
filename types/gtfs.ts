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
  lineName: string;
  shortName: string | null;
  longName: string | null;
  color: string;
  points: [number, number][];
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
