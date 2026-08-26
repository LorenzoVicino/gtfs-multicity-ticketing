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
  exceptions?: GtfsBuilderServiceException[];
};

export type GtfsBuilderServiceException = {
  date: string;
  exceptionType: "1" | "2";
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
  stopSequence?: number;
  pickupType?: "0" | "1" | "2" | "3";
  dropOffType?: "0" | "1" | "2" | "3";
  shapeDistTraveled?: string;
};

export type GtfsBuilderTrip = {
  id: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  shortName?: string;
  directionId: 0 | 1;
  blockId?: string;
  shapeId?: string;
  wheelchairAccessible?: "0" | "1" | "2";
  bikesAllowed?: "0" | "1" | "2";
  stopTimes: GtfsBuilderStopTime[];
};

export type GtfsBuilderFeedInfo = {
  publisherName: string;
  publisherUrl: string;
  lang: string;
  startDate: string;
  endDate: string;
  version: string;
  contactEmail?: string;
  contactUrl?: string;
};

export type GtfsSourceFile = {
  name: string;
  size: number;
  managed: boolean;
};

export type GtfsSourceArchive = {
  token: string;
  sha256: string;
  fileName: string;
  files: GtfsSourceFile[];
  originalFingerprint: string;
};

export type GtfsBuilderDraft = {
  version: 2;
  project: GtfsBuilderProject;
  agencies: GtfsBuilderAgency[];
  services: GtfsBuilderService[];
  stops: GtfsBuilderStop[];
  routes: GtfsBuilderRoute[];
  trips: GtfsBuilderTrip[];
  feedInfo?: GtfsBuilderFeedInfo;
  sourceArchive?: GtfsSourceArchive;
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

export type CanonicalGtfsNotice = {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  totalNotices: number;
  sampleNotices?: Array<Record<string, unknown>>;
};

export type CanonicalGtfsValidation = {
  valid: boolean;
  validatorVersion: string;
  validatedAt?: string;
  validationTimeSeconds?: number;
  errors: number;
  warnings: number;
  infos: number;
  files: string[];
  counts: Record<string, number>;
  notices: CanonicalGtfsNotice[];
};
