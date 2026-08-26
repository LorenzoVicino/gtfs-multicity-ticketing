# GTFS directories

Recommended layout for GTFS feeds:

```text
data/gtfs/
  raw/
    MIL/
      feed.zip or extracted .txt files
    ROM/
      feed.zip or extracted .txt files
  incoming/
    # Temporary workspace for extraction and fallback files
```

## Required feed files

- `agency.txt`
- `routes.txt`
- `stops.txt`
- `trips.txt`
- `stop_times.txt`

## Supported optional files

- `calendar.txt` (an empty fallback is created when missing)
- `fare_attributes.txt` (an empty fallback is created when missing)

## Example

```powershell
.\scripts\import_gtfs.ps1 `
  -CityCode MIL `
  -CityName "Milan" `
  -FeedPath ".\data\gtfs\raw\MIL\feed.zip" `
  -ServiceDate 2026-02-18 `
  -DbName gtfs_hub
```
