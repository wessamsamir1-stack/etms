import { z, ZodTypeAny } from 'zod';
import { ApiError } from './middleware/context';

/** Parse `data` with a zod schema, throwing a 422 problem+json on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(
      422,
      'VALIDATION_ERROR',
      r.error.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`).join('; '),
    );
  }
  return r.data;
}
