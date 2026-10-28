"use client";

import { useState } from "react";
import type { ConnectorLogoSource } from "@/lib/connectors/logo-sources";

interface ConnectorLogoProps {
  connectorName: string;
  color: string;
  initials: string;
  logoSource?: ConnectorLogoSource | null;
  imageClassName?: string;
  fallbackClassName?: string;
}

export function ConnectorLogo({
  connectorName,
  color,
  initials,
  logoSource,
  imageClassName = "h-7 w-7",
  fallbackClassName = "text-xs",
}: ConnectorLogoProps) {
  const [failed, setFailed] = useState(false);

  if (logoSource && !failed) {
    return (
      <img
        src={logoSource.src}
        alt={`${connectorName} logo`}
        className={`${imageClassName} object-contain`}
        loading="lazy"
        title={logoSource.sourceLabel}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span className={`${fallbackClassName} font-bold`} style={{ color }}>
      {initials}
    </span>
  );
}
