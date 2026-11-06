export interface VenueLogoAddresses {
  readonly light: string;
  readonly dark: string | null;
}

export interface VenueThemeAnswer {
  readonly hash: string;
  readonly css: string;
  readonly logo: VenueLogoAddresses | null;
}

function isAddress(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isVenueLogo(value: unknown): value is VenueLogoAddresses | null {
  if (value === null) return true;
  const logo = value as Record<string, unknown> | undefined;
  return isAddress(logo?.light) && (logo.dark === null || isAddress(logo.dark));
}

export function isVenueThemeAnswer(value: unknown): value is VenueThemeAnswer {
  const answer = value as Record<string, unknown> | null | undefined;
  return (
    typeof answer?.hash === "string" && typeof answer.css === "string" && isVenueLogo(answer.logo)
  );
}
