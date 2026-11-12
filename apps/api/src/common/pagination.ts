import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Cursor pagination, newest first. Ids are time-sortable ULIDs, so the
 * cursor is simply the last id of the previous page and each page is an
 * index range scan (`id < cursor ORDER BY id DESC LIMIT n`). Unlike
 * OFFSET, it stays fast at any depth and never skips or repeats rows when
 * new ones arrive between requests.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z
    .string()
    .regex(/^[a-z]{2,4}_[0-9A-Z]{26}$/, 'must be a cursor from a previous page')
    .optional(),
});

export interface Page<T> {
  data: T[];
  /** Pass as `cursor` to fetch the next (older) page; `null` on the last page. */
  nextCursor: string | null;
}

/** Callers fetch `limit + 1` rows; the extra row only tells us whether another page exists. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const data = rows.slice(0, limit);
  return {
    data,
    nextCursor: rows.length > limit ? (data.at(-1)?.id ?? null) : null,
  };
}

export function pageSchema(item: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: item },
      nextCursor: { type: 'string', nullable: true },
    },
  };
}

export const paginationQueryDocs = [
  {
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: 'cursor',
    required: false,
    description: '`nextCursor` from the previous page',
    schema: { type: 'string' },
  },
] as const;
