param(
    [Parameter(Mandatory = $true)]
    [string]$CityCode,

    [Parameter(Mandatory = $true)]
    [string]$FeedPath,

    [string]$ServiceDate = (Get-Date -Format "yyyy-MM-dd"),
    [string]$CityName = "",
    [string]$DbName = "gtfs_ticketing",
    [string]$DbUser = ""
)

$ErrorActionPreference = "Stop"

function Resolve-GtfsFile {
    param(
        [Parameter(Mandatory = $true)] [string]$Directory,
        [Parameter(Mandatory = $true)] [string]$FileNameLower
    )

    return Get-ChildItem -Path $Directory -File | Where-Object { $_.Name.ToLower() -eq $FileNameLower } | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($CityName)) {
    $CityName = $CityCode
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$incomingDir = Join-Path $repoRoot "data\gtfs\incoming"
New-Item -ItemType Directory -Force -Path $incomingDir | Out-Null

$feedFullPath = (Resolve-Path $FeedPath).Path
$workingDir = ""

if ((Get-Item $feedFullPath).PSIsContainer) {
    $workingDir = $feedFullPath
} elseif ($feedFullPath.ToLower().EndsWith(".zip")) {
    $extractDir = Join-Path $incomingDir ("extract_{0}_{1}" -f $CityCode.ToUpper(), (Get-Date -Format "yyyyMMdd_HHmmss"))
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    Expand-Archive -Path $feedFullPath -DestinationPath $extractDir -Force
    $workingDir = $extractDir
} else {
    throw "FeedPath deve essere una cartella GTFS o un file .zip"
}

$requiredFiles = @(
    "agency.txt",
    "routes.txt",
    "stops.txt",
    "trips.txt",
    "stop_times.txt"
)

$optionalFiles = @{
    "calendar.txt" = "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date"
    "fare_attributes.txt" = "fare_id,price,currency_type,payment_method,transfers,transfer_duration"
}

$resolved = @{}
foreach ($name in $requiredFiles) {
    $file = Resolve-GtfsFile -Directory $workingDir -FileNameLower $name
    if (-not $file) {
        throw "File GTFS mancante: $name in $workingDir"
    }
    $resolved[$name] = ($file.FullName -replace "\\", "/")
}

foreach ($key in $optionalFiles.Keys) {
    $file = Resolve-GtfsFile -Directory $workingDir -FileNameLower $key
    if ($file) {
        $resolved[$key] = ($file.FullName -replace "\\", "/")
    } else {
        $fallback = Join-Path $incomingDir ("{0}_{1}" -f $CityCode.ToUpper(), $key)
        Set-Content -Path $fallback -Value $optionalFiles[$key] -Encoding UTF8
        $resolved[$key] = ($fallback -replace "\\", "/")
    }
}

$psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCmd) {
    throw "psql non trovato nel PATH. Installa PostgreSQL client e riprova."
}

$sqlFile = (Join-Path $repoRoot "db\import_gtfs.sql")

$args = @(
    "-v", "ON_ERROR_STOP=1",
    "-v", "city_code=$($CityCode.ToUpper())",
    "-v", "city_name=$CityName",
    "-v", "service_date=$ServiceDate",
    "-v", "agency_file=$($resolved["agency.txt"])",
    "-v", "routes_file=$($resolved["routes.txt"])",
    "-v", "stops_file=$($resolved["stops.txt"])",
    "-v", "calendar_file=$($resolved["calendar.txt"])",
    "-v", "trips_file=$($resolved["trips.txt"])",
    "-v", "stop_times_file=$($resolved["stop_times.txt"])",
    "-v", "fare_attributes_file=$($resolved["fare_attributes.txt"])",
    "-d", $DbName,
    "-f", $sqlFile
)

if (-not [string]::IsNullOrWhiteSpace($DbUser)) {
    $args = @("-U", $DbUser) + $args
}

Write-Host "Import GTFS avviato..."
Write-Host "  CityCode: $($CityCode.ToUpper())"
Write-Host "  CityName: $CityName"
Write-Host "  ServiceDate: $ServiceDate"
Write-Host "  Source: $workingDir"

& $psqlCmd.Source @args
if ($LASTEXITCODE -ne 0) {
    throw "Import GTFS fallito con exit code $LASTEXITCODE"
}

Write-Host "Import GTFS completato con successo."

