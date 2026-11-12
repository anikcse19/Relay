import { z } from 'zod';
import { paginationSchema } from '../common/pagination.js';

/** Dot-separated segments, e.g. `invoice.paid`. */
export const EVENT_TYPE_PATTERN = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

/**
 * Request body for `POST /v1/events`. Mirrors the Standard Webhooks payload
 * shape (`type` + `data`); Relay adds `timestamp` and the id when delivering.
 */
export const createEventSchema = z.object({
  type: z
    .string()
    .max(100)
    .regex(
      EVENT_TYPE_PATTERN,
      'must be dot-separated segments of letters, digits, "_" or "-" (e.g. invoice.paid)',
    )
    .describe('Event type, e.g. `invoice.paid`. Endpoints can filter on it.'),
  data: z
    .record(z.string(), z.unknown())
    .describe('Event payload (a JSON object), delivered to endpoints as-is.'),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

export const listEventsSchema = paginationSchema
  .extend({
    type: z.string().max(100).regex(EVENT_TYPE_PATTERN).optional().describe('Exact event type'),
    from: z.iso.datetime({ offset: true }).optional().describe('Created at or after (inclusive)'),
    to: z.iso.datetime({ offset: true }).optional().describe('Created before (exclusive)'),
    endpointId: z
      .string()
      .regex(/^ep_[0-9A-Z]{26}$/, 'must be an endpoint id')
      .optional()
      .describe('Only events delivered to this endpoint'),
    status: z
      .enum(['pending', 'retrying', 'succeeded', 'failed', 'cancelled'])
      .optional()
      .describe('Only events with a delivery in this status (to `endpointId`, if given)'),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` must be before `to`',
    path: ['from'],
  });

export type ListEventsQuery = z.infer<typeof listEventsSchema>;

/** Visible ASCII + space, as recommended for idempotency keys; long enough for a UUID or hash. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7E]{1,255}$/;
