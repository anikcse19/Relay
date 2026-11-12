/**
 * Endpoints per environment are few (tens), so one page of 100 is the whole
 * list; the API is paginated for API-key clients that manage many.
 * (Not in `api.ts`: server pages can't import values from 'use client' modules.)
 */
export const ENDPOINTS_PAGE_SIZE = 100;
