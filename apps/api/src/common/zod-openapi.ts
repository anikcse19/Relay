import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Converts a Zod schema to an OpenAPI schema, so request validation and API
 * docs come from one definition and cannot drift apart.
 */
export function openApiSchema(schema: z.ZodType): SchemaObject {
  const json: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: 'input' }) };
  delete json.$schema; // JSON Schema dialect marker; not valid inside an OpenAPI document
  return json as SchemaObject;
}
