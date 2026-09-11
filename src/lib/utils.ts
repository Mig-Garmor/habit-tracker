import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes with later ones winning. Used by the shadcn components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
