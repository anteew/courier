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
