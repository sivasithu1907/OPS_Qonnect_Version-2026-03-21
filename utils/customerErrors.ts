import type { Customer } from '../types';

/** Thrown when a customer cannot be created/changed because the mobile number already belongs to another client.
 *  `existing` is that client, so the form can show its name + number and offer "Use existing client". */
export class DuplicateCustomerError extends Error {
  code = 'DUPLICATE_PHONE' as const;
  existing: Customer;
  constructor(message: string, existing: Customer) {
    super(message);
    this.name = 'DuplicateCustomerError';
    this.existing = existing;
  }
}
export const isDuplicateCustomerError = (e: unknown): e is DuplicateCustomerError => !!e && (e as any).code === 'DUPLICATE_PHONE' && !!(e as any).existing;
