export type AgencyTicketType = {
  ticketTypeId: number;
  fareId: number | null;
  name: string;
  durationMinutes: number;
  priceCents: number;
  active: boolean;
};

export type AgencyTicketCatalogItem = {
  agencyId: number;
  gtfsAgencyId: string;
  agencyName: string;
  ticketTypes: AgencyTicketType[];
};

export type CityTicketCatalog = {
  city: {
    id: number;
    cityCode: string;
    name: string;
  };
  agencies: AgencyTicketCatalogItem[];
};
