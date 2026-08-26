"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { City, CityGtfsPayload, RouteLine } from "@/types/gtfs";
import type { GtfsBuilderDraft } from "@/types/gtfs-builder";

const CityMap = dynamic(() => import("@/components/CityMap").then((mod) => mod.CityMap), {
  ssr: false
});

const GtfsBuilder = dynamic(() => import("@/components/GtfsBuilder").then((mod) => mod.GtfsBuilder), {
  ssr: false
});

const TRANSITION_MS = 620;
const HERO_BACKGROUND_INTERVAL_MS = 8_000;
const HERO_BACKGROUND_FADE_MS = 1_400;
const HERO_BACKGROUNDS = [
  "/hero-backgrounds/current.webp",
  "/hero-backgrounds/guillaume-lebelt.webp",
  "/hero-backgrounds/chan-lee.webp",
  "/hero-backgrounds/alain-duss.webp",
  "/hero-backgrounds/amy-chen.webp",
  "/hero-backgrounds/mitchell-johnson.webp",
  "/hero-backgrounds/ash-gerlach.webp",
  "/hero-backgrounds/kit-suman.webp",
  "/hero-backgrounds/jeshoots.webp",
  "/hero-backgrounds/tapio-haaja.webp"
] as const;
type Stage = "hero" | "leaving" | "map";
type RouteCategoryFilter = "all" | "core" | "secondary" | "local";

function routeStorageKey(cityCode: string): string {
  return `active-routes-${cityCode}`;
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
  const [isGtfsBuilderOpen, setIsGtfsBuilderOpen] = useState(false);
  const [gtfsBuilderMode, setGtfsBuilderMode] = useState<"create" | "edit">("create");
  const [gtfsBuilderDraft, setGtfsBuilderDraft] = useState<GtfsBuilderDraft | undefined>();
  const [gtfsBuilderSourceLabel, setGtfsBuilderSourceLabel] = useState<string | undefined>();
  const [heroBackgroundIndex, setHeroBackgroundIndex] = useState(0);
  const [heroPreviousBackgroundIndex, setHeroPreviousBackgroundIndex] = useState<number | null>(null);
  const [isStopPanelOpen, setIsStopPanelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const gtfsInputRef = useRef<HTMLInputElement | null>(null);
  const gtfsBuilderTriggerRef = useRef<HTMLButtonElement | null>(null);
  const gtfsEditTriggerRef = useRef<HTMLButtonElement | null>(null);
  const heroBackgroundIndexRef = useRef(0);

  const loadCities = useCallback(async () => {
    const response = await fetch("/api/cities");
    if (!response.ok) {
      throw new Error("Errore caricamento citta");
    }

    const data = (await response.json()) as { cities: City[] };
    setCities(data.cities);
  }, []);

  const closeGtfsBuilder = useCallback(() => {
    setIsGtfsBuilderOpen(false);
    setGtfsBuilderDraft(undefined);
    window.requestAnimationFrame(() => (gtfsBuilderMode === "edit" ? gtfsEditTriggerRef.current : gtfsBuilderTriggerRef.current)?.focus());
  }, [gtfsBuilderMode]);

  const openEmptyGtfsBuilder = useCallback(() => {
    setGtfsBuilderMode("create");
    setGtfsBuilderDraft(undefined);
    setGtfsBuilderSourceLabel(undefined);
    setIsGtfsBuilderOpen(true);
  }, []);

  const openCityGtfsBuilder = useCallback(async () => {
    if (!selectedCode) return;
    try {
      setError(null);
      setIsLoading(true);
      const response = await fetch(`/api/cities/${encodeURIComponent(selectedCode)}/gtfs/edit`);
      const result = (await response.json().catch(() => ({}))) as { draft?: GtfsBuilderDraft; error?: string; details?: string };
      if (!response.ok || !result.draft) throw new Error(result.details ?? result.error ?? "Apertura GTFS fallita");
      setGtfsBuilderMode("edit");
      setGtfsBuilderDraft(result.draft);
      setGtfsBuilderSourceLabel(`${result.draft.project.cityName} · GTFS Hub`);
      setIsGtfsBuilderOpen(true);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Apertura GTFS fallita");
    } finally {
      setIsLoading(false);
    }
  }, [selectedCode]);

  const handleGtfsBuilderImported = useCallback(async (cityCode: string, cityName: string) => {
    await loadCities();
    setSelectedCode(cityCode);
    setQuery(cityName);
    setIsDropdownOpen(false);
    setIsGtfsBuilderOpen(false);
    setStage("leaving");
  }, [loadCities]);

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
    const nextIndex = (heroBackgroundIndex + 1) % HERO_BACKGROUNDS.length;
    const nextImage = new Image();
    nextImage.src = HERO_BACKGROUNDS[nextIndex];
  }, [heroBackgroundIndex]);

  useEffect(() => {
    if (stage !== "hero" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const interval = window.setInterval(() => {
      const currentIndex = heroBackgroundIndexRef.current;
      const nextIndex = (currentIndex + 1) % HERO_BACKGROUNDS.length;
      setHeroPreviousBackgroundIndex(currentIndex);
      heroBackgroundIndexRef.current = nextIndex;
      setHeroBackgroundIndex(nextIndex);
    }, HERO_BACKGROUND_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [stage]);

  useEffect(() => {
    if (heroPreviousBackgroundIndex === null) {
      return;
    }
    const timeout = window.setTimeout(() => setHeroPreviousBackgroundIndex(null), HERO_BACKGROUND_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [heroBackgroundIndex, heroPreviousBackgroundIndex]);

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
      setGtfsUploadProgress(30);
      const response = await fetch("/api/gtfs/parse", { method: "POST", body: formData });
      const result = (await response.json().catch(() => ({}))) as { draft?: GtfsBuilderDraft; error?: string; details?: string };
      if (!response.ok || !result.draft) throw new Error(result.details ?? result.error ?? "Apertura GTFS fallita");
      setGtfsUploadProgress(100);
      setGtfsBuilderMode("edit");
      setGtfsBuilderDraft(result.draft);
      setGtfsBuilderSourceLabel(file.name);
      setIsGtfsBuilderOpen(true);
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
      <section
        className={`hero-screen ${stage !== "hero" ? "hero-screen-leaving" : ""}`}
        aria-hidden={isGtfsBuilderOpen ? true : undefined}
        inert={isGtfsBuilderOpen ? true : undefined}
      >
        <div className="hero-background" aria-hidden="true">
          {heroPreviousBackgroundIndex !== null ? (
            <div
              className="hero-background-image hero-background-image-previous"
              style={{ backgroundImage: `url(${HERO_BACKGROUNDS[heroPreviousBackgroundIndex]})` }}
            />
          ) : null}
          <div
            key={HERO_BACKGROUNDS[heroBackgroundIndex]}
            className="hero-background-image hero-background-image-current"
            style={{ backgroundImage: `url(${HERO_BACKGROUNDS[heroBackgroundIndex]})` }}
          />
        </div>
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
                <div className="gtfs-builder-callout">
                  <div className="gtfs-builder-callout-copy">
                    <span className="gtfs-builder-badge">Nuovo</span>
                    <strong>Non hai ancora un GTFS?</strong>
                    <p>Disegna fermate e linee sulla mappa, aggiungi le corse e genera tutto da zero.</p>
                  </div>
                  <button
                    ref={gtfsBuilderTriggerRef}
                    type="button"
                    className="gtfs-builder-launch"
                    onClick={openEmptyGtfsBuilder}
                  >
                    Crea GTFS da zero <span aria-hidden="true">→</span>
                  </button>
                </div>
                <div className="gtfs-upload-divider"><span>oppure importa un archivio</span></div>
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
                    {isUploadingGtfs ? "Apertura in corso..." : "Apri e modifica GTFS"}
                  </button>
                  {isUploadingGtfs ? (
                    <div className="gtfs-upload-progress" aria-live="polite">
                      <div className="gtfs-upload-progress-bar">
                        <span
                          className="gtfs-upload-progress-fill"
                          style={{ width: `${Math.max(gtfsUploadProgress, 4)}%` }}
                        />
                      </div>
                      <p className="gtfs-upload-progress-label">Preparazione Studio {gtfsUploadProgress}%</p>
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

      <section
        className={`map-screen ${stage === "hero" ? "map-screen-hidden" : "map-screen-active"}`}
        aria-hidden={isGtfsBuilderOpen ? true : undefined}
        inert={isGtfsBuilderOpen ? true : undefined}
      >
        <div className={`map-stage ${stage === "map" ? "map-stage-visible" : ""}`}>
          <div className="map-fullscreen">
            <CityMap
              payload={payload}
              activeRouteIds={mapRouteIds}
              focusedRouteId={focusedRouteId}
              onStopPanelChange={setIsStopPanelOpen}
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
                        {route.geometry === "stops" ? (
                          <span
                            className="line-badge line-badge-approx"
                            title="Percorso ricostruito collegando le fermate: il feed non contiene shapes.txt per questa linea."
                          >
                            tracciato approssimato
                          </span>
                        ) : null}
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

        {isLoading ? <div className="map-loading map-ui-enter map-ui-delay-1">Caricamento rete trasporto...</div> : null}
        {error ? <div className="map-error map-ui-enter map-ui-delay-1">{error}</div> : null}

        <button
          className={`map-back map-ui-enter map-ui-delay-0 ${isStopPanelOpen ? "map-floating-shifted" : ""}`}
          type="button"
          onClick={backToHero}
        >
          Cambia citta
        </button>
        {payload ? (
          <button
            ref={gtfsEditTriggerRef}
            className={`map-edit map-ui-enter map-ui-delay-1 ${isStopPanelOpen ? "map-floating-shifted" : ""}`}
            type="button"
            disabled={isLoading}
            onClick={() => void openCityGtfsBuilder()}
          >
            Modifica GTFS
          </button>
        ) : null}
      </section>

      {isGtfsBuilderOpen ? (
        <GtfsBuilder
          onClose={closeGtfsBuilder}
          onImported={handleGtfsBuilderImported}
          initialDraft={gtfsBuilderDraft}
          mode={gtfsBuilderMode}
          sourceLabel={gtfsBuilderSourceLabel}
        />
      ) : null}
    </main>
  );
}
