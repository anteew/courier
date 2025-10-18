import { z } from 'zod';

export interface Envelope<Payload = any> {
  id: string;
  ts: string; // RFC3339 UTC
  from?: string;
  to: string; // stream address
  type: string;
  schema?: string;
  version?: number;
  corr?: string;
  refs?: string[];
  tags?: string[];
  headers?: Record<string, any>;
  payload: Payload;
}

export const EnvelopeSchema = z.object({
  id: z.string().min(1),
  ts: z.string().min(1),
  from: z.string().optional(),
  to: z.string().min(1),
  type: z.string().min(1),
  schema: z.string().optional(),
  version: z.number().optional(),
  corr: z.string().optional(),
  refs: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.any()).optional(),
  payload: z.any(),
});

export function parseEnvelope(input: unknown): Envelope {
  return EnvelopeSchema.parse(input) as Envelope;
}
