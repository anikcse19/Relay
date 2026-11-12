/**
 * Shared by server and client components. (A value exported from a
 * 'use client' module becomes a client reference on the server, so it can't
 * live in sidebar.tsx.)
 */
export const SIDEBAR_COOKIE = 'relay.sidebar';
