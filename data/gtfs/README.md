# Cartelle GTFS

Struttura consigliata per i feed GTFS:

```text
data/gtfs/
  raw/
    MIL/
      feed.zip oppure file .txt estratti
    ROM/
      feed.zip oppure file .txt estratti
  incoming/
    # cartella di lavoro temporanea per estrazioni/fallback
```

## File richiesti nel feed

- `agency.txt`
- `routes.txt`
- `stops.txt`
- `trips.txt`
- `stop_times.txt`

## File opzionali gestiti

- `calendar.txt` (se assente viene creato fallback vuoto)
- `fare_attributes.txt` (se assente viene creato fallback vuoto)

## Esempio

```powershell
.\scripts\import_gtfs.ps1 `
  -CityCode MIL `
  -CityName "Milano" `
  -FeedPath ".\data\gtfs\raw\MIL\feed.zip" `
  -ServiceDate 2026-02-18 `
  -DbName gtfs_ticketing
```

