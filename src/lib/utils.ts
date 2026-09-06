import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, letting later classes win over earlier ones.
 *
 * Used by the marketing components in src/components/site. The application's
 * own components predate this and compose classes by hand; there is no need
 * to convert them.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
