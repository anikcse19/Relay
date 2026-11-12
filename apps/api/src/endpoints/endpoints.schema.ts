import { z } from 'zod';
import { EVENT_TYPE_PATTERN } from '../events/events.schema.js';
import { paginationSchema } from '../common/pagination.js';

/** RFC 9110 `token`: the characters allowed in a header name. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;

/**
 * Headers Relay sets itself. Customers can't override them: doing so would
 * break signature verification or HTTP framing for their own receiver.
 */
const RESERVED_HEADERS = new Set([
  'content-type',
  'content-length',
  'transfer-encoding',
  'connection',
  'host',
  'user-agent',
  'webhook-id',
  'webhook-timestamp',
  'webhook-signature',
]);

const urlField = z.string().trim().min(1).max(2048).describe('Where deliveries are POSTed');

const descriptionField = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .describe('Free-text note shown in the dashboard');

const filterField = z
  .array(z.string().max(100).regex(EVENT_TYPE_PATTERN, 'must be a valid event type'))
  .min(1)
  .max(50)
  .nullable()
  .describe('Event types to receive. `null` or omitted = every event type.')
  .transform((types) => (types === null ? null : [...new Set(types)].sort()));

const headersField = z
  .record(
    z
      .string()
      .regex(HEADER_NAME, 'must be a valid HTTP header name')
      .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), {
        message: 'is set by Relay and cannot be overridden',
      }),
    // No CR/LF: a header value must never be able to inject another header.
    z
      .string()
      .max(1000)
      .regex(/^[^\r\n]*$/, 'must not contain line breaks'),
  )
  .refine((h) => Object.keys(h).length <= 20, { message: 'at most 20 headers' })
  .describe(
    'Static headers sent with every delivery, e.g. to authenticate with your receiver. ' +
      'Values are write-only: responses list header names only.',
  );

export const createEndpointSchema = z.object({
  url: urlField,
  description: descriptionField.optional(),
  filterEventTypes: filterField.optional(),
  headers: headersField.optional(),
});

export const updateEndpointSchema = z
  .object({
    url: urlField,
    description: descriptionField,
    filterEventTypes: filterField,
    headers: headersField.describe('Replaces the whole set of custom headers.'),
    status: z
      .enum(['active', 'paused'])
      .describe('Pause to hold deliveries (they are kept, not dropped); resume to send them.'),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Provide at least one field.' });

export const listEndpointsSchema = paginationSchema;

export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
