"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { City, CityGtfsPayload, RouteLine } from "@/types/gtfs";

const CityMap = dynamic(() => import("@/components/CityMap").then((mod) => mod.CityMap), {
  ssr: false
});

const TRANSITION_MS = 620;
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
  const [activeRouteIds, setActiveRouteIds] = useState<number[]>([]);
  const [focusedRouteId, setFocusedRouteId] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [gtfsFileName, setGtfsFileName] = useState<string | null>(null);
  const [gtfsUploadError, setGtfsUploadError] = useState<string | null>(null);
  const [uploadCityCode, setUploadCityCode] = useState("");
  const [uploadCityName, setUploadCityName] = useState("");
  const [isUploadingGtfs, setIsUploadingGtfs] = useState(false);
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const gtfsInputRef = useRef<HTMLInputElement | null>(null);

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
      if (!q) {
        return true;
      }
      const label = routeLabel(route).toLowerCase();
      return label.includes(q) || route.lineName.toLowerCase().includes(q);
    });
  }, [lineSearch, sortedRoutes, routeCategoryFilter]);

  const selectedCity = cities.find((city) => city.cityCode === selectedCode) ?? null;
  const activeSet = useMemo(() => new Set(activeRouteIds), [activeRouteIds]);

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

  function selectAllRoutes() {
    if (!payload) {
      return;
    }
    setActiveRouteIds(payload.routes.map((route) => route.routeId));
  }

  function clearAllRoutes() {
    setActiveRouteIds([]);
  }

  function selectCoreRoutes() {
    if (!payload) {
      return;
    }
    const core = payload.routes.filter((route) => route.routeCategory === "core").map((route) => route.routeId);
    setActiveRouteIds(core);
  }

  function selectCoreSecondaryRoutes() {
    if (!payload) {
      return;
    }
    const selected = payload.routes
      .filter((route) => route.routeCategory === "core" || route.routeCategory === "secondary")
      .map((route) => route.routeId);
    setActiveRouteIds(selected);
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
      const formData = new FormData();
      formData.append("file", file);
      formData.append("cityCode", cityCode);
      formData.append("cityName", cityName);

      const response = await fetch("/api/gtfs/upload", {
        method: "POST",
        body: formData
      });

      const result = (await response.json()) as { error?: string; cityCode?: string; cityName?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Import GTFS fallito");
      }

      await loadCities();
      setSelectedCode(cityCode);
      setQuery(cityName);
      setStage("leaving");
      setGtfsUploadError(null);
    } catch (uploadError) {
      setGtfsUploadError(uploadError instanceof Error ? uploadError.message : "Import GTFS fallito");
    } finally {
      setIsUploadingGtfs(false);
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
            <CityMap payload={payload} activeRouteIds={activeRouteIds} focusedRouteId={focusedRouteId} />
          </div>

          {payload ? (
            <aside className="line-sidebar">
              <div className="line-sidebar-head">
                <p className="line-sidebar-title">Linee</p>
                <p className="line-sidebar-subtitle">{activeRouteIds.length} attive su {payload.routes.length}</p>
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

              <div className="line-controls">
                <div className="line-control-group">
                  <p className="line-control-label">Categorie</p>
                  <div className="line-actions line-actions-category">
                    <button type="button" onClick={selectCoreRoutes}>Principali</button>
                    <button type="button" onClick={selectCoreSecondaryRoutes}>Core+Secondarie</button>
                  </div>
                </div>

                <div className="line-control-group">
                  <p className="line-control-label">Azioni</p>
                  <div className="line-actions line-actions-global">
                    <button type="button" onClick={selectAllRoutes}>Seleziona tutto</button>
                    <button type="button" onClick={clearAllRoutes}>Deseleziona tutto</button>
                  </div>
                </div>
              </div>

              <div className="line-list">
                {visibleRoutes.map((route) => (
                  <label
                    key={route.routeId}
                    className={`line-item ${activeSet.has(route.routeId) ? "line-item-active" : ""}`}
                    onMouseEnter={() => setFocusedRouteId(route.routeId)}
                    onMouseLeave={() => setFocusedRouteId(null)}
                  >
                    <input
                      type="checkbox"
                      checked={activeSet.has(route.routeId)}
                      onChange={() => toggleRoute(route.routeId)}
                    />
                    <span className="line-swatch" style={{ backgroundColor: route.color }} />
                    <span className="line-text">
                      {routeLabel(route)}
                      {route.routeCategory === "core" ? " • Principale" : null}
                      {route.routeCategory === "secondary" ? " • Secondaria" : null}
                    </span>
                  </label>
                ))}
              </div>
            </aside>
          ) : null}

          {payload && activeRouteIds.length === 0 ? (
            <div className="empty-overlay">Nessuna linea selezionata. Attiva almeno una linea dal pannello.</div>
          ) : null}
        </div>

        {selectedCity ? (
          <div className="map-city-pill">
            {selectedCity.name} ({selectedCity.cityCode})
          </div>
        ) : null}

        {isLoading ? <div className="map-loading">Caricamento rete trasporto...</div> : null}
        {error ? <div className="map-error">{error}</div> : null}

        <button className="map-back" type="button" onClick={backToHero}>
          Cambia citta
        </button>
      </section>
    </main>
  );
}
