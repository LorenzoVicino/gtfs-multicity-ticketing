"use client";

import dynamic from "next/dynamic";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QrTicket } from "@/components/QrTicket";
import { getTicketDisplayName, getTicketMetaLabel } from "@/lib/ticket-display";
import type { City, CityGtfsPayload, RouteLine } from "@/types/gtfs";

const CityMap = dynamic(() => import("@/components/CityMap").then((mod) => mod.CityMap), {
  ssr: false
});

const TRANSITION_MS = 620;
const OVERLAY_EXIT_MS = 240;
type Stage = "hero" | "leaving" | "map";
type RouteCategoryFilter = "all" | "core" | "secondary" | "local";
type WalletStatus = "idle" | "loading" | "ready" | "error";

type WalletBooking = {
  bookingCode: string;
  status: string;
  createdAt: string;
  totalCents: number;
  tickets: Array<{
    ticketCode: string;
    status: string;
    validUntil: string | null;
    passengerName: string | null;
    qrToken: string | null;
    agencyId: number | null;
    agencyName: string | null;
    ticketTypeId: number | null;
    ticketTypeName: string | null;
    durationMinutes: number | null;
    priceCents: number | null;
  }>;
};

function routeStorageKey(cityCode: string): string {
  return `active-routes-${cityCode}`;
}

function walletStorageKey(cityCode: string): string {
  return `wallet-cache-v2-${cityCode}`;
}

function routeLabel(route: RouteLine): string {
  if (route.shortName && route.longName) {
    return `${route.shortName} - ${route.longName}`;
  }
  return route.shortName ?? route.longName ?? route.lineName;
}

function routeSortValue(route: RouteLine): { numeric: number; text: string } {
  const seed = route.shortName ?? route.lineName;
  const match = seed.match(/\d+/);
  const numeric = match ? Number(match[0]) : Number.POSITIVE_INFINITY;
  return { numeric, text: seed.toLowerCase() };
}

function routeCategoryLabel(category: RouteLine["routeCategory"]): string {
  if (category === "core") {
    return "Principale";
  }
  if (category === "secondary") {
    return "Secondaria";
  }
  return "Locale";
}

function ticketStatusLabel(status: string): string {
  if (status === "ISSUED") {
    return "Pronto all'uso";
  }
  if (status === "VALIDATED") {
    return "Validato";
  }
  if (status === "EXPIRED") {
    return "Scaduto";
  }
  return status;
}

function ticketStatusClassName(status: string): string {
  if (status === "ISSUED") {
    return "wallet-status-issued";
  }
  if (status === "VALIDATED") {
    return "wallet-status-validated";
  }
  if (status === "EXPIRED") {
    return "wallet-status-expired";
  }
  return "wallet-status-default";
}

function ticketValidityLabel(validUntil: string | null): string {
  if (!validUntil) {
    return "Da validare";
  }

  return new Date(validUntil).toLocaleString("it-IT");
}

function mergeWalletBookings(primary: WalletBooking[], secondary: WalletBooking[]): WalletBooking[] {
  const bookings = new Map<string, WalletBooking>();

  for (const source of [...secondary, ...primary]) {
    const current = bookings.get(source.bookingCode);
    if (!current) {
      bookings.set(source.bookingCode, {
        ...source,
        tickets: [...source.tickets]
      });
      continue;
    }

    const tickets = new Map<string, (typeof source.tickets)[number]>();
    for (const ticket of [...current.tickets, ...source.tickets]) {
      tickets.set(ticket.ticketCode, ticket);
    }

    bookings.set(source.bookingCode, {
      ...current,
      ...source,
      tickets: Array.from(tickets.values())
    });
  }

  return Array.from(bookings.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function CityExplorer() {
  const [cities, setCities] = useState<City[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [payload, setPayload] = useState<CityGtfsPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("hero");
  const [lineSearch, setLineSearch] = useState("");
  const [routeCategoryFilter, setRouteCategoryFilter] = useState<RouteCategoryFilter>("all");
  const [agencyFilter, setAgencyFilter] = useState("all");
  const [activeRouteIds, setActiveRouteIds] = useState<number[]>([]);
  const [focusedRouteId, setFocusedRouteId] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [gtfsFileName, setGtfsFileName] = useState<string | null>(null);
  const [gtfsUploadError, setGtfsUploadError] = useState<string | null>(null);
  const [gtfsUploadProgress, setGtfsUploadProgress] = useState(0);
  const [uploadCityCode, setUploadCityCode] = useState("");
  const [uploadCityName, setUploadCityName] = useState("");
  const [isUploadingGtfs, setIsUploadingGtfs] = useState(false);
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false);
  const [isWalletOpen, setIsWalletOpen] = useState(false);
  const [isWalletClosing, setIsWalletClosing] = useState(false);
  const [walletEmail, setWalletEmail] = useState("");
  const [walletStatus, setWalletStatus] = useState<WalletStatus>("idle");
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletBookings, setWalletBookings] = useState<WalletBooking[]>([]);
  const [selectedWalletTicketCode, setSelectedWalletTicketCode] = useState<string | null>(null);
  const [isWalletQrOpen, setIsWalletQrOpen] = useState(false);
  const [isWalletQrClosing, setIsWalletQrClosing] = useState(false);
  const [copiedTicketCode, setCopiedTicketCode] = useState<string | null>(null);
  const [isStopPanelOpen, setIsStopPanelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const gtfsInputRef = useRef<HTMLInputElement | null>(null);
  const walletCloseTimerRef = useRef<number | null>(null);
  const walletQrCloseTimerRef = useRef<number | null>(null);

  const readSessionWallet = useCallback((cityCode: string): WalletBooking[] => {
    if (typeof window === "undefined") {
      return [];
    }

    try {
      const raw = window.sessionStorage.getItem(walletStorageKey(cityCode));
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw) as WalletBooking[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

  const writeSessionWallet = useCallback((cityCode: string, bookings: WalletBooking[]) => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.setItem(walletStorageKey(cityCode), JSON.stringify(bookings));
    } catch {
      // Ignore browser storage failures.
    }
  }, []);

  const loadCities = useCallback(async () => {
    const response = await fetch("/api/cities");
    if (!response.ok) {
      throw new Error("Errore caricamento citta");
    }

    const data = (await response.json()) as { cities: City[] };
    setCities(data.cities);
  }, []);

  useEffect(() => {
    let ignore = false;

    async function initCities() {
      try {
        await loadCities();
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Errore imprevisto");
        }
      }
    }

    initCities();
    return () => {
      ignore = true;
    };
  }, [loadCities]);

  useEffect(() => {
    if (!selectedCode) {
      setPayload(null);
      return;
    }

    let ignore = false;

    async function loadGtfs() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`/api/cities/${selectedCode}/gtfs`);
        if (!response.ok) {
          throw new Error("Errore caricamento GTFS");
        }

        const data = (await response.json()) as CityGtfsPayload;
        if (!ignore) {
          setPayload(data);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Errore imprevisto");
          setPayload(null);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    loadGtfs();
    return () => {
      ignore = true;
    };
  }, [selectedCode]);

  useEffect(() => {
    if (!payload) {
      setActiveRouteIds([]);
      return;
    }

    const allRouteIds = payload.routes.map((route) => route.routeId);
    const key = routeStorageKey(payload.city.cityCode);

    try {
      const saved = window.localStorage.getItem(key);
      if (!saved) {
        const coreIds = payload.routes
          .filter((route) => route.routeCategory === "core")
          .map((route) => route.routeId);
        setActiveRouteIds(coreIds.length > 0 ? coreIds : allRouteIds.slice(0, Math.min(20, allRouteIds.length)));
        return;
      }

      const parsed = JSON.parse(saved) as number[];
      const selected = allRouteIds.filter((id) => parsed.includes(id));
      setActiveRouteIds(selected.length > 0 ? selected : allRouteIds);
    } catch {
      setActiveRouteIds(allRouteIds);
    }
  }, [payload]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    const sessionBookings = readSessionWallet(payload.city.cityCode);
    if (sessionBookings.length === 0) {
      return;
    }

    setWalletBookings((current) => mergeWalletBookings(current, sessionBookings));
    setWalletStatus((current) => (current === "idle" ? "ready" : current));
    setSelectedWalletTicketCode((current) => current ?? sessionBookings[0]?.tickets[0]?.ticketCode ?? null);
  }, [payload, readSessionWallet]);

  useEffect(() => {
    if (!payload) {
      return;
    }

    const key = routeStorageKey(payload.city.cityCode);
    window.localStorage.setItem(key, JSON.stringify(activeRouteIds));
  }, [activeRouteIds, payload]);

  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (!dropdownRef.current) {
        return;
      }

      if (!dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocumentClick);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (walletCloseTimerRef.current !== null) {
        window.clearTimeout(walletCloseTimerRef.current);
      }
      if (walletQrCloseTimerRef.current !== null) {
        window.clearTimeout(walletQrCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if ((!isWalletOpen || isWalletClosing) && (!isWalletQrOpen || isWalletQrClosing)) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (isWalletQrOpen && !isWalletQrClosing) {
        setIsWalletQrClosing(true);
        walletQrCloseTimerRef.current = window.setTimeout(() => {
          setIsWalletQrOpen(false);
          setIsWalletQrClosing(false);
          walletQrCloseTimerRef.current = null;
        }, OVERLAY_EXIT_MS);
        return;
      }

      if (isWalletOpen && !isWalletClosing) {
        setIsWalletClosing(true);
        walletCloseTimerRef.current = window.setTimeout(() => {
          setIsWalletOpen(false);
          setIsWalletClosing(false);
          walletCloseTimerRef.current = null;
        }, OVERLAY_EXIT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isWalletClosing, isWalletOpen, isWalletQrClosing, isWalletQrOpen]);

  useEffect(() => {
    if (stage !== "leaving") {
      return;
    }

    const timer = window.setTimeout(() => {
      setStage("map");
    }, TRANSITION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [stage]);

  const filteredCities = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return cities;
    }

    return cities.filter(
      (city) =>
        city.name.toLowerCase().includes(normalized) || city.cityCode.toLowerCase().includes(normalized)
    );
  }, [cities, query]);

  const sortedRoutes = useMemo(() => {
    if (!payload) {
      return [] as RouteLine[];
    }

    return [...payload.routes].sort((a, b) => {
      const left = routeSortValue(a);
      const right = routeSortValue(b);

      if (left.numeric !== right.numeric) {
        return left.numeric - right.numeric;
      }

      return left.text.localeCompare(right.text, "it");
    });
  }, [payload]);

  const visibleRoutes = useMemo(() => {
    const q = lineSearch.trim().toLowerCase();
    return sortedRoutes.filter((route) => {
      if (routeCategoryFilter !== "all" && route.routeCategory !== routeCategoryFilter) {
        return false;
      }
      if (agencyFilter !== "all" && String(route.agencyId) !== agencyFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      const label = routeLabel(route).toLowerCase();
      return label.includes(q) || route.lineName.toLowerCase().includes(q);
    });
  }, [agencyFilter, lineSearch, sortedRoutes, routeCategoryFilter]);

  const availableAgencies = useMemo(() => {
    if (!payload) {
      return [] as Array<{ agencyId: number; agencyName: string }>;
    }

    const agencies = new Map<number, string>();
    for (const route of payload.routes) {
      if (route.agencyId === null || !route.agencyName) {
        continue;
      }
      agencies.set(route.agencyId, route.agencyName);
    }

    return Array.from(agencies.entries())
      .map(([agencyId, agencyName]) => ({ agencyId, agencyName }))
      .sort((a, b) => a.agencyName.localeCompare(b.agencyName, "it"));
  }, [payload]);

  const selectedCity = cities.find((city) => city.cityCode === selectedCode) ?? null;
  const activeSet = useMemo(() => new Set(activeRouteIds), [activeRouteIds]);
  const visibleRouteIds = useMemo(() => visibleRoutes.map((route) => route.routeId), [visibleRoutes]);
  const visibleRouteIdSet = useMemo(() => new Set(visibleRouteIds), [visibleRouteIds]);
  const mapRouteIds = useMemo(
    () => activeRouteIds.filter((routeId) => visibleRouteIdSet.has(routeId)),
    [activeRouteIds, visibleRouteIdSet]
  );
  const allWalletTickets = useMemo(
    () =>
      walletBookings.flatMap((booking) =>
        booking.tickets.map((ticket) => ({
          ...ticket,
          bookingCode: booking.bookingCode,
          bookingStatus: booking.status,
          createdAt: booking.createdAt,
          totalCents: booking.totalCents
        }))
      ),
    [walletBookings]
  );
  const selectedWalletTicket = useMemo(
    () => allWalletTickets.find((ticket) => ticket.ticketCode === selectedWalletTicketCode) ?? null,
    [allWalletTickets, selectedWalletTicketCode]
  );

  function onCitySelect(city: City) {
    setSelectedCode(city.cityCode);
    setQuery(city.name);
    setIsDropdownOpen(false);
    setStage("leaving");
  }

  function backToHero() {
    setStage("hero");
    setIsDropdownOpen(false);
    setSelectedCode("");
    setPayload(null);
    setQuery("");
    setLineSearch("");
    setRouteCategoryFilter("all");
    setAgencyFilter("all");
    setActiveRouteIds([]);
    setFocusedRouteId(null);
    setIsWalletOpen(false);
    setWalletBookings([]);
    setWalletError(null);
    setWalletStatus("idle");
    setSelectedWalletTicketCode(null);
    setIsWalletQrOpen(false);
    setIsWalletClosing(false);
    setIsWalletQrClosing(false);
    setCopiedTicketCode(null);
  }

  function openWallet() {
    if (walletCloseTimerRef.current !== null) {
      window.clearTimeout(walletCloseTimerRef.current);
      walletCloseTimerRef.current = null;
    }
    setIsWalletClosing(false);
    setIsWalletOpen(true);
    setWalletError(null);
  }

  function openWalletQr() {
    if (walletQrCloseTimerRef.current !== null) {
      window.clearTimeout(walletQrCloseTimerRef.current);
      walletQrCloseTimerRef.current = null;
    }
    setIsWalletQrClosing(false);
    setIsWalletQrOpen(true);
  }

  const closeWalletQr = useCallback(() => {
    setIsWalletQrClosing(true);
    walletQrCloseTimerRef.current = window.setTimeout(() => {
      setIsWalletQrOpen(false);
      setIsWalletQrClosing(false);
      walletQrCloseTimerRef.current = null;
    }, OVERLAY_EXIT_MS);
  }, []);

  const closeWallet = useCallback(() => {
    setIsWalletClosing(true);
    if (isWalletQrOpen) {
      closeWalletQr();
    }
    walletCloseTimerRef.current = window.setTimeout(() => {
      setIsWalletOpen(false);
      setIsWalletClosing(false);
      walletCloseTimerRef.current = null;
    }, OVERLAY_EXIT_MS);
  }, [closeWalletQr, isWalletQrOpen]);

  async function copyTicketCode(ticketCode: string) {
    try {
      await navigator.clipboard.writeText(ticketCode);
      setCopiedTicketCode(ticketCode);
      window.setTimeout(() => {
        setCopiedTicketCode((current) => (current === ticketCode ? null : current));
      }, 1800);
    } catch {
      setWalletError("Copia del codice ticket non riuscita");
    }
  }

  const loadWalletByEmail = useCallback(
    async (rawEmail: string, preferredTicketCode?: string | null) => {
      const email = rawEmail.trim().toLowerCase();
      setWalletEmail(email);

      if (!email) {
        setWalletStatus("error");
        setWalletError("Inserisci l'email usata per l'acquisto");
        return;
      }

      try {
        setWalletStatus("loading");
        setWalletError(null);

        const response = await fetch(`/api/bookings?email=${encodeURIComponent(email)}&limit=20&offset=0`);
        const json = (await response.json()) as
          | { bookings: WalletBooking[] }
          | { error?: string; details?: string };

        if (!response.ok) {
          throw new Error(
            ("error" in json && json.error) || ("details" in json && json.details) || "Errore caricamento wallet"
          );
        }

        const bookings = "bookings" in json ? json.bookings : [];
        const mergedBookings = payload
          ? mergeWalletBookings(bookings, readSessionWallet(payload.city.cityCode))
          : bookings;

        setWalletBookings(mergedBookings);
        setWalletStatus("ready");
        setIsWalletOpen(true);
        if (payload) {
          writeSessionWallet(payload.city.cityCode, mergedBookings);
        }

        const allTickets = mergedBookings.flatMap((booking) => booking.tickets);
        const resolvedTicketCode =
          (preferredTicketCode && allTickets.find((ticket) => ticket.ticketCode === preferredTicketCode)?.ticketCode) ??
          allTickets[0]?.ticketCode ??
          null;

        setSelectedWalletTicketCode(resolvedTicketCode);
      } catch (walletLoadError) {
        setWalletStatus("error");
        setWalletError(walletLoadError instanceof Error ? walletLoadError.message : "Errore caricamento wallet");
        setWalletBookings([]);
        setSelectedWalletTicketCode(null);
      }
    },
    [payload, readSessionWallet, writeSessionWallet]
  );

  async function handleWalletSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const email = walletEmail.trim().toLowerCase();
    if (!email) {
      setWalletStatus("error");
      setWalletError("Inserisci l'email usata per l'acquisto");
      return;
    }

    await loadWalletByEmail(email);
  }

  async function handlePurchaseCompleted(result: {
    email: string;
    ticketCode: string | null;
    purchase: {
      bookingCode: string;
      totalCents: number;
      agency: {
        agencyId: number;
        name: string;
      };
      ticketType: {
        ticketTypeId: number;
        name: string;
        durationMinutes: number;
        priceCents: number;
      };
      tickets: Array<{ ticketCode: string; passengerName: string; qrToken: string }>;
    };
  }) {
    if (payload) {
      const localBooking: WalletBooking = {
        bookingCode: result.purchase.bookingCode,
        status: "PAID",
        createdAt: new Date().toISOString(),
        totalCents: result.purchase.totalCents,
        tickets: result.purchase.tickets.map((ticket) => ({
          ticketCode: ticket.ticketCode,
          status: "ISSUED",
          validUntil: null,
          passengerName: ticket.passengerName,
          qrToken: ticket.qrToken,
          agencyId: result.purchase.agency.agencyId,
          agencyName: result.purchase.agency.name,
          ticketTypeId: result.purchase.ticketType.ticketTypeId,
          ticketTypeName: result.purchase.ticketType.name,
          durationMinutes: result.purchase.ticketType.durationMinutes,
          priceCents: result.purchase.ticketType.priceCents
        }))
      };

      setWalletBookings((current) => {
        const merged = mergeWalletBookings([localBooking], current);
        writeSessionWallet(payload.city.cityCode, merged);
        return merged;
      });
      setWalletStatus("ready");
      setWalletEmail(result.email);
      setSelectedWalletTicketCode(result.ticketCode ?? localBooking.tickets[0]?.ticketCode ?? null);
    }
  }

  function toggleRoute(routeId: number) {
    setActiveRouteIds((prev) => {
      if (prev.includes(routeId)) {
        return prev.filter((id) => id !== routeId);
      }
      return [...prev, routeId];
    });
  }

  function updateVisibleSelection(nextVisibleRouteIds: number[]) {
    setActiveRouteIds((prev) => {
      const hiddenSelections = prev.filter((routeId) => !visibleRouteIdSet.has(routeId));
      return [...hiddenSelections, ...nextVisibleRouteIds];
    });
  }

  function selectAllRoutes() {
    if (!payload) {
      return;
    }
    updateVisibleSelection(visibleRouteIds);
  }

  function clearAllRoutes() {
    updateVisibleSelection([]);
  }

  function selectCoreRoutes() {
    if (!payload) {
      return;
    }
    const core = visibleRoutes
      .filter((route) => route.routeCategory === "core")
      .map((route) => route.routeId);
    updateVisibleSelection(core);
  }

  function selectSecondaryRoutes() {
    if (!payload) {
      return;
    }
    const selected = visibleRoutes
      .filter((route) => route.routeCategory === "secondary")
      .map((route) => route.routeId);
    updateVisibleSelection(selected);
  }

  function isZipFile(file: File): boolean {
    return file.name.toLowerCase().endsWith(".zip");
  }

  function uploadGtfsWithProgress(formData: FormData): Promise<{
    error?: string;
    details?: string;
    cityCode?: string;
    cityName?: string;
  }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/gtfs/upload");
      xhr.responseType = "json";

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) {
          return;
        }
        setGtfsUploadProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };

      xhr.onerror = () => {
        reject(new Error("Upload GTFS non riuscito"));
      };

      xhr.onload = () => {
        const result =
          typeof xhr.response === "object" && xhr.response !== null
            ? (xhr.response as { error?: string; details?: string; cityCode?: string; cityName?: string })
            : {};

        if (xhr.status >= 200 && xhr.status < 300) {
          setGtfsUploadProgress(100);
          resolve(result);
          return;
        }

        reject(new Error(result.details ?? result.error ?? "Import GTFS fallito"));
      };

      xhr.send(formData);
    });
  }

  async function onGtfsFileSelected(file: File | null) {
    if (!file) {
      return;
    }

    if (!isZipFile(file)) {
      setGtfsUploadError("Formato non supportato. Carica un file .zip");
      setGtfsFileName(null);
      return;
    }

    setGtfsUploadError(null);
    setGtfsFileName(file.name);

    const cityCode = uploadCityCode.trim().toUpperCase();
    const cityName = uploadCityName.trim();

    if (!cityCode || !cityName) {
      setGtfsUploadError("Inserisci city code e nome citta prima del caricamento");
      return;
    }

    try {
      setIsUploadingGtfs(true);
      setGtfsUploadProgress(0);
      const formData = new FormData();
      formData.append("file", file);
      formData.append("cityCode", cityCode);
      formData.append("cityName", cityName);

      await uploadGtfsWithProgress(formData);

      await loadCities();
      setSelectedCode(cityCode);
      setQuery(cityName);
      setStage("leaving");
      setGtfsUploadError(null);
    } catch (uploadError) {
      setGtfsUploadError(uploadError instanceof Error ? uploadError.message : "Import GTFS fallito");
    } finally {
      setIsUploadingGtfs(false);
      setGtfsUploadProgress(0);
      if (gtfsInputRef.current) {
        gtfsInputRef.current.value = "";
      }
    }
  }

  return (
    <main className="experience-root">
      <section className={`hero-screen ${stage !== "hero" ? "hero-screen-leaving" : ""}`}>
        <div className="hero-content">
          <p className="hero-kicker">GTFS Hub</p>
          <h1 className="hero-title">Scegli la tua citta</h1>
          <div className="hero-combobox" ref={dropdownRef}>
            <button
              className="hero-combobox-trigger"
              type="button"
              onClick={() => setIsDropdownOpen((value) => !value)}
              aria-expanded={isDropdownOpen}
              aria-controls="city-dropdown-menu"
            >
              {selectedCity ? `${selectedCity.name} (${selectedCity.cityCode})` : "Seleziona una citta"}
            </button>

            {isDropdownOpen ? (
              <div className="hero-combobox-menu" id="city-dropdown-menu">
                <input
                  id="citySearch"
                  className="hero-combobox-input"
                  placeholder="Scrivi nome citta o codice..."
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  autoFocus
                />

                <div className="hero-combobox-list">
                  {filteredCities.length === 0 ? (
                    <p className="hero-empty">Nessuna citta trovata</p>
                  ) : (
                    filteredCities.map((city) => (
                      <button
                        key={city.cityCode}
                        type="button"
                        className="hero-combobox-item"
                        onClick={() => onCitySelect(city)}
                      >
                        {city.name} ({city.cityCode})
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <div className="gtfs-upload">
            <button
              type="button"
              className="gtfs-upload-toggle"
              onClick={() => setIsUploadPanelOpen((prev) => !prev)}
              aria-expanded={isUploadPanelOpen}
            >
              Non trovi la tua citta?
            </button>

            {isUploadPanelOpen ? (
              <>
                <p className="gtfs-upload-subtitle">
                  Carica un file GTFS (.zip) e visualizzalo direttamente sulla mappa.
                </p>
                <div className="gtfs-upload-meta">
                  <input
                    className="gtfs-meta-input"
                    placeholder="City code (es. BRI)"
                    value={uploadCityCode}
                    onChange={(event) => setUploadCityCode(event.target.value.toUpperCase())}
                  />
                  <input
                    className="gtfs-meta-input"
                    placeholder="Nome citta (es. Bari)"
                    value={uploadCityName}
                    onChange={(event) => setUploadCityName(event.target.value)}
                  />
                </div>
                <div
                  className={`gtfs-dropzone ${isDragOver ? "gtfs-dropzone-over" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsDragOver(false);
                    const file = event.dataTransfer.files?.[0] ?? null;
                    onGtfsFileSelected(file);
                  }}
                >
                  <input
                    ref={gtfsInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="gtfs-file-input"
                    onChange={(event) => {
                      void onGtfsFileSelected(event.target.files?.[0] ?? null);
                    }}
                  />
                  <button
                    type="button"
                    className="gtfs-upload-button"
                    disabled={isUploadingGtfs}
                    onClick={() => gtfsInputRef.current?.click()}
                  >
                    {isUploadingGtfs ? "Import in corso..." : "Carica GTFS"}
                  </button>
                  {isUploadingGtfs ? (
                    <div className="gtfs-upload-progress" aria-live="polite">
                      <div className="gtfs-upload-progress-bar">
                        <span
                          className="gtfs-upload-progress-fill"
                          style={{ width: `${Math.max(gtfsUploadProgress, 4)}%` }}
                        />
                      </div>
                      <p className="gtfs-upload-progress-label">Caricamento {gtfsUploadProgress}%</p>
                    </div>
                  ) : null}
                  <p className="gtfs-upload-format">Formato supportato: .zip</p>
                  {gtfsFileName ? <p className="gtfs-upload-file">File selezionato: {gtfsFileName}</p> : null}
                  {gtfsUploadError ? <p className="gtfs-upload-error">{gtfsUploadError}</p> : null}
                </div>
              </>
            ) : null}
          </div>
          {error ? <p className="hero-error">{error}</p> : null}
        </div>
      </section>

      <section className={`map-screen ${stage === "hero" ? "map-screen-hidden" : "map-screen-active"}`}>
        <div className={`map-stage ${stage === "map" ? "map-stage-visible" : ""}`}>
          <div className="map-fullscreen">
            <CityMap
              payload={payload}
              activeRouteIds={mapRouteIds}
              focusedRouteId={focusedRouteId}
              onStopPanelChange={setIsStopPanelOpen}
              onPurchaseCompleted={(result) => {
                void handlePurchaseCompleted(result);
              }}
            />
          </div>

          {payload ? (
            <aside className="line-sidebar">
              <div className="line-sidebar-head">
                <div>
                  <p className="line-sidebar-title">Linee</p>
                  <p className="line-sidebar-subtitle">Filtra le linee e scegli quali tenere attive in mappa.</p>
                </div>
                <span className="line-sidebar-total">{payload.routes.length} totali</span>
              </div>

              <input
                className="line-search"
                placeholder="Cerca linea..."
                value={lineSearch}
                onChange={(event) => setLineSearch(event.target.value)}
              />

              <select
                className="line-category-filter"
                value={routeCategoryFilter}
                onChange={(event) => setRouteCategoryFilter(event.target.value as RouteCategoryFilter)}
              >
                <option value="all">Tutte le categorie</option>
                <option value="core">Principali</option>
                <option value="secondary">Secondarie</option>
                <option value="local">Locali</option>
              </select>

              <select
                className="line-category-filter"
                value={agencyFilter}
                onChange={(event) => setAgencyFilter(event.target.value)}
              >
                <option value="all">Tutte le agency</option>
                {availableAgencies.map((agency) => (
                  <option key={agency.agencyId} value={String(agency.agencyId)}>
                    {agency.agencyName}
                  </option>
                ))}
              </select>

              <div className="line-summary" aria-label="Riepilogo linee">
                <span className="line-summary-pill">
                  <strong>{payload.routes.length}</strong> totali
                </span>
                <span className="line-summary-pill">
                  <strong>{visibleRoutes.length}</strong> visibili
                </span>
                <span className="line-summary-pill">
                  <strong>{mapRouteIds.length}</strong> in mappa
                </span>
              </div>

              <div className="line-controls">
                <div className="line-control-group">
                  <p className="line-control-label">Selezione</p>
                  <p className="line-control-help">
                    Le azioni lavorano solo sulle linee visibili con i filtri correnti.
                  </p>
                  <div className="line-actions">
                    <button type="button" onClick={selectAllRoutes}>Attiva visibili</button>
                    <button type="button" onClick={clearAllRoutes}>Nessuna</button>
                    <button type="button" onClick={selectCoreRoutes}>Principali</button>
                    <button type="button" onClick={selectSecondaryRoutes}>Secondarie</button>
                  </div>
                </div>
              </div>

              <div className="line-list">
                <div className="line-list-head">
                  <p className="line-list-title">Linee visibili</p>
                  <span className="line-list-active-count">{mapRouteIds.length} attive</span>
                </div>

                {visibleRoutes.length === 0 ? (
                  <div className="line-empty-state">
                    Nessuna linea trovata con i filtri attuali. Cambia ricerca, categoria o agency.
                  </div>
                ) : null}

                {visibleRoutes.map((route) => (
                  <label
                    key={route.routeId}
                    className={`line-item ${activeSet.has(route.routeId) ? "line-item-active" : ""}`}
                    onMouseEnter={() => setFocusedRouteId(route.routeId)}
                    onMouseLeave={() => setFocusedRouteId(null)}
                  >
                    <input
                      className="line-checkbox"
                      type="checkbox"
                      checked={activeSet.has(route.routeId)}
                      onChange={() => toggleRoute(route.routeId)}
                    />
                    <span className="line-item-rail" aria-hidden="true" />
                    <span className="line-swatch" style={{ backgroundColor: route.color }} />
                    <span className="line-text">
                      <span className="line-title">{routeLabel(route)}</span>
                      <span className="line-badges">
                        <span className="line-badge line-badge-agency">{route.agencyName ?? "Agency"}</span>
                        <span className={`line-badge line-badge-${route.routeCategory}`}>
                          {routeCategoryLabel(route.routeCategory)}
                        </span>
                      </span>
                    </span>
                    {activeSet.has(route.routeId) ? <span className="line-item-state">Attiva</span> : null}
                  </label>
                ))}
              </div>
            </aside>
          ) : null}

          {payload && mapRouteIds.length === 0 ? (
            <div className="empty-overlay">Nessuna linea selezionata. Attiva almeno una linea dal pannello.</div>
          ) : null}
        </div>

        {selectedCity ? (
          <div className="map-city-pill map-ui-enter map-ui-delay-0">
            {selectedCity.name} ({selectedCity.cityCode})
          </div>
        ) : null}

        {payload ? (
          <button
            className={`map-wallet map-ui-enter map-ui-delay-2 ${isStopPanelOpen ? "map-floating-shifted" : ""}`}
            type="button"
            onClick={openWallet}
          >
            I miei biglietti
          </button>
        ) : null}

        {isLoading ? <div className="map-loading map-ui-enter map-ui-delay-1">Caricamento rete trasporto...</div> : null}
        {error ? <div className="map-error map-ui-enter map-ui-delay-1">{error}</div> : null}

        <button
          className={`map-back map-ui-enter map-ui-delay-0 ${isStopPanelOpen ? "map-floating-shifted" : ""}`}
          type="button"
          onClick={backToHero}
        >
          Cambia citta
        </button>
      </section>

      {isWalletOpen ? (
        <div
          className={`wallet-overlay ${isWalletClosing ? "map-ui-exit" : "map-ui-enter map-ui-delay-1"}`}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeWallet();
            }
          }}
        >
          <div className="wallet-shell">
            <div className="wallet-head">
              <div>
                <p className="wallet-title">Portafoglio biglietti</p>
                <p className="wallet-subtitle">Recupera i titoli acquistati e apri il QR firmato.</p>
                <p className="wallet-local-note">I biglietti appena acquistati restano disponibili in questa sessione browser.</p>
              </div>
              <button type="button" className="wallet-close" onClick={closeWallet}>
                Chiudi
              </button>
            </div>

            <form className="wallet-search" onSubmit={handleWalletSubmit}>
              <input
                className="wallet-input"
                type="email"
                placeholder="Email usata per l'acquisto"
                value={walletEmail}
                onChange={(event) => setWalletEmail(event.target.value)}
              />
              <button type="submit" className="wallet-submit" disabled={walletStatus === "loading"}>
                {walletStatus === "loading" ? "Caricamento..." : "Apri wallet"}
              </button>
            </form>

            {walletError ? <p className="wallet-error">{walletError}</p> : null}

            <div className="wallet-body">
              <div className="wallet-list">
                {walletStatus === "ready" && allWalletTickets.length === 0 ? (
                  <p className="wallet-empty">Nessun biglietto disponibile in questa sessione o per l&apos;email inserita.</p>
                ) : null}

                {allWalletTickets.map((ticket) => (
                  <button
                    key={ticket.ticketCode}
                    type="button"
                    className={`wallet-ticket-row ${
                      selectedWalletTicketCode === ticket.ticketCode ? "wallet-ticket-card-active" : ""
                    }`}
                    onClick={() => setSelectedWalletTicketCode(ticket.ticketCode)}
                  >
                    <span className="wallet-ticket-main">
                      <span className="wallet-ticket-kicker">{ticket.agencyName ?? "Agency"}</span>
                      <span className="wallet-ticket-name">
                        {getTicketDisplayName(ticket.ticketTypeName ?? ticket.ticketCode, ticket.durationMinutes ?? 0)}
                      </span>
                      <span className="wallet-ticket-meta">
                      {ticket.passengerName ?? "Passeggero"} ·{" "}
                      {ticket.durationMinutes !== null && ticket.priceCents !== null
                        ? getTicketMetaLabel(
                            ticket.ticketTypeName ?? ticket.ticketCode,
                            ticket.durationMinutes,
                            ticket.priceCents
                          )
                        : ticket.ticketCode}
                    </span>
                    </span>
                    <span className={`wallet-ticket-status ${ticketStatusClassName(ticket.status)}`}>
                      {ticketStatusLabel(ticket.status)}
                    </span>
                  </button>
                ))}
              </div>

              <div className="wallet-detail">
                {selectedWalletTicket ? (
                  <>
                    <div className="wallet-detail-card">
                      <div className="wallet-detail-hero">
                        <div>
                          <p className="wallet-detail-kicker">{selectedWalletTicket.agencyName ?? "Agency"}</p>
                          <p className="wallet-detail-title">
                            {getTicketDisplayName(
                              selectedWalletTicket.ticketTypeName ?? "Biglietto",
                              selectedWalletTicket.durationMinutes ?? 0
                            )}
                          </p>
                        </div>
                        <span className={`wallet-detail-status ${ticketStatusClassName(selectedWalletTicket.status)}`}>
                          {ticketStatusLabel(selectedWalletTicket.status)}
                        </span>
                      </div>

                      {selectedWalletTicket.durationMinutes !== null && selectedWalletTicket.priceCents !== null ? (
                        <p className="wallet-detail-summary">
                          {getTicketMetaLabel(
                            selectedWalletTicket.ticketTypeName ?? "Biglietto",
                            selectedWalletTicket.durationMinutes,
                            selectedWalletTicket.priceCents
                          )}
                        </p>
                      ) : null}

                      <div className="wallet-detail-grid">
                        <div className="wallet-detail-field">
                          <span className="wallet-detail-label">Passeggero</span>
                          <span className="wallet-detail-value">{selectedWalletTicket.passengerName ?? "-"}</span>
                        </div>
                        <div className="wallet-detail-field">
                          <span className="wallet-detail-label">Validita</span>
                          <span className="wallet-detail-value">
                            {ticketValidityLabel(selectedWalletTicket.validUntil)}
                          </span>
                        </div>
                        <div className="wallet-detail-field">
                          <span className="wallet-detail-label">Codice ticket</span>
                          <div className="wallet-detail-code-row">
                            <span className="wallet-detail-value wallet-detail-mono">
                              {selectedWalletTicket.ticketCode}
                            </span>
                            <button
                              type="button"
                              className="wallet-copy-button"
                              onClick={() => {
                                void copyTicketCode(selectedWalletTicket.ticketCode);
                              }}
                            >
                              {copiedTicketCode === selectedWalletTicket.ticketCode ? "Copiato" : "Copia codice"}
                            </button>
                          </div>
                        </div>
                        <div className="wallet-detail-field">
                          <span className="wallet-detail-label">Codice booking</span>
                          <span className="wallet-detail-value wallet-detail-mono">
                            {selectedWalletTicket.bookingCode}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="wallet-qr-card">
                      <div className="wallet-qr-head">
                        <div>
                          <p className="wallet-qr-title">Mostra il QR a bordo</p>
                          <p className="wallet-qr-help">Questo e` il biglietto da esibire per la validazione.</p>
                        </div>
                        <button
                          type="button"
                          className="wallet-fullscreen-button"
                          onClick={openWalletQr}
                        >
                          Schermo intero
                        </button>
                      </div>
                      {selectedWalletTicket.qrToken ? (
                        <div className="wallet-qr-visual">
                          <QrTicket value={selectedWalletTicket.qrToken} size={232} className="wallet-qr-svg" />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="wallet-placeholder">
                    <p className="wallet-empty">Apri un biglietto recente o cerca per email per vedere i dettagli.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isWalletQrOpen && selectedWalletTicket ? (
        <div
          className={`wallet-qr-overlay ${isWalletQrClosing ? "map-ui-exit" : "map-ui-enter map-ui-delay-1"}`}
          role="dialog"
          aria-modal="true"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeWalletQr();
            }
          }}
        >
          <div className="wallet-qr-fullscreen">
            <div className="wallet-qr-fullscreen-head">
              <div>
                <p className="wallet-detail-kicker">{selectedWalletTicket.agencyName ?? "Agency"}</p>
                <p className="wallet-qr-fullscreen-title">
                  {getTicketDisplayName(
                    selectedWalletTicket.ticketTypeName ?? "Biglietto",
                    selectedWalletTicket.durationMinutes ?? 0
                  )}
                </p>
                <p className="wallet-qr-fullscreen-subtitle">
                  {selectedWalletTicket.passengerName ?? "Passeggero"} -{" "}
                  {ticketStatusLabel(selectedWalletTicket.status)}
                </p>
              </div>
              <button type="button" className="wallet-close" onClick={closeWalletQr}>
                Chiudi
              </button>
            </div>

            <div className="wallet-qr-fullscreen-visual">
              {selectedWalletTicket.qrToken ? (
                <QrTicket value={selectedWalletTicket.qrToken} size={360} className="wallet-qr-fullscreen-svg" />
              ) : (
                <p className="wallet-empty">QR non disponibile</p>
              )}
            </div>

            <div className="wallet-qr-fullscreen-footer">
              <span className={`wallet-detail-status ${ticketStatusClassName(selectedWalletTicket.status)}`}>
                {ticketStatusLabel(selectedWalletTicket.status)}
              </span>
              <button
                type="button"
                className="wallet-copy-button"
                onClick={() => {
                  void copyTicketCode(selectedWalletTicket.ticketCode);
                }}
              >
                {copiedTicketCode === selectedWalletTicket.ticketCode ? "Codice copiato" : "Copia codice ticket"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

