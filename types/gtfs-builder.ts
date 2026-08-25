export type GtfsBuilderStep = "agency" | "stops" | "routes" | "service" | "publish";

export type GtfsServiceDays = {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
};

export type GtfsBuilderProject = {
  cityCode: string;
  cityName: string;
};

export type GtfsBuilderAgency = {
  id: string;
  name: string;
  url: string;
  timezone: string;
  lang: string;
  phone: string;
};

export type GtfsBuilderService = {
  id: string;
  startDate: string;
  endDate: string;
  days: GtfsServiceDays;
};

export type GtfsBuilderStop = {
  id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  zoneId?: string;
  locationType?: "0" | "1" | "2" | "3" | "4";
  parentStation?: string;
  wheelchairBoarding: "0" | "1" | "2";
};

export type GtfsBuilderRoute = {
  id: string;
  agencyId: string;
  shortName: string;
  longName: string;
  type: number;
  color: string;
  textColor: string;
  stopIds: string[];
};

export type GtfsBuilderStopTime = {
  stopId: string;
  arrivalTime: string;
  departureTime: string;
  pickupType?: "0" | "1" | "2" | "3";
  dropOffType?: "0" | "1" | "2" | "3";
};

export type GtfsBuilderTrip = {
  id: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  shortName?: string;
  directionId: 0 | 1;
  blockId?: string;
  wheelchairAccessible?: "0" | "1" | "2";
  bikesAllowed?: "0" | "1" | "2";
  stopTimes: GtfsBuilderStopTime[];
};

export type GtfsBuilderDraft = {
  version: 2;
  project: GtfsBuilderProject;
  agencies: GtfsBuilderAgency[];
  services: GtfsBuilderService[];
  stops: GtfsBuilderStop[];
  routes: GtfsBuilderRoute[];
  trips: GtfsBuilderTrip[];
  updatedAt: string;
};

export type LegacyGtfsBuilderDraft = {
  version: 1;
  project: GtfsBuilderProject & {
    agencyId: string;
    agencyName: string;
    agencyUrl: string;
    agencyTimezone: string;
    agencyLang: string;
    serviceId: string;
    serviceStartDate: string;
    serviceEndDate: string;
    serviceDays: GtfsServiceDays;
  };
  stops: GtfsBuilderStop[];
  routes: Array<Omit<GtfsBuilderRoute, "agencyId">>;
  trips: Array<Omit<GtfsBuilderTrip, "serviceId">>;
  updatedAt: string;
};

export type GtfsBuilderIssue = {
  step: GtfsBuilderStep;
  field?: string;
  message: string;
};
