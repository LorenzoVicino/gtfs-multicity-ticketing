"use client";

import { useMemo } from "react";
import { renderQrSvg } from "@/lib/qr-svg";

type Props = {
  value: string;
  size?: number;
  className?: string;
};

export function QrTicket({ value, size = 220, className }: Props) {
  const qrState = useMemo(() => {
    try {
      return {
        svgMarkup: renderQrSvg(value, 4, 4),
        error: null as string | null
      };
    } catch (error) {
      return {
        svgMarkup: null,
        error: error instanceof Error ? error.message : "QR non disponibile"
      };
    }
  }, [value]);

  if (!qrState.svgMarkup) {
    return (
      <div className={`${className ?? ""} qr-ticket-fallback`.trim()} style={{ width: size, height: size }}>
        <div className="qr-ticket-fallback-inner">
          <span className="qr-ticket-fallback-title">QR non renderizzato</span>
          <span className="qr-ticket-fallback-text">
            {qrState.error === "QR payload too large"
              ? "Payload troppo grande per il renderer locale."
              : qrState.error}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: qrState.svgMarkup }}
    />
  );
}
