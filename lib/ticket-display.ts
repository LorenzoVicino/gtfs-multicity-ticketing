function compactDurationLabel(durationMinutes: number): string {
  if (durationMinutes % 10080 === 0) {
    const weeks = durationMinutes / 10080;
    return weeks === 1 ? "1 settimana" : `${weeks} settimane`;
  }

  if (durationMinutes % 1440 === 0) {
    const days = durationMinutes / 1440;
    return days === 1 ? "1 giorno" : `${days} giorni`;
  }

  if (durationMinutes % 60 === 0) {
    const hours = durationMinutes / 60;
    return hours === 1 ? "1 ora" : `${hours} ore`;
  }

  return `${durationMinutes} min`;
}

function marketingLabelFromDuration(durationMinutes: number): string | null {
  if (durationMinutes === 60) {
    return "Biglietto 1 ora";
  }

  if (durationMinutes === 90) {
    return "Biglietto 90 minuti";
  }

  if (durationMinutes === 1440) {
    return "Pass giornaliero";
  }

  if (durationMinutes === 10080) {
    return "Pass settimanale";
  }

  return null;
}

export function getTicketDisplayName(name: string, durationMinutes: number): string {
  const normalized = name.trim();
  const lower = normalized.toLowerCase();
  const marketingLabel = marketingLabelFromDuration(durationMinutes);

  if (
    lower === "urban 90" ||
    lower.startsWith("gtfs fare ") ||
    lower === "day pass" ||
    lower === "week pass"
  ) {
    return marketingLabel ?? normalized;
  }

  return normalized;
}

export function getTicketDurationBadge(durationMinutes: number): string {
  if (durationMinutes === 1440) {
    return "Giornaliero";
  }

  if (durationMinutes === 10080) {
    return "Settimanale";
  }

  return compactDurationLabel(durationMinutes);
}

export function getTicketMetaLabel(name: string, durationMinutes: number, priceCents: number): string {
  return `${getTicketDurationBadge(durationMinutes)} · €${(priceCents / 100).toFixed(2)}`;
}
