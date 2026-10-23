import { type ClassValue, clsx } from 'clsx';

/** Join class names, dropping the falsy ones: `cn('ptab', active && 'active')`. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
