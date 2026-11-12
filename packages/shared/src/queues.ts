/**
 * Queue names and job payloads shared by producers (API) and consumers
 * (workers). Payloads carry only ids: the database row is the source of
 * truth, so a job can never act on stale data copied at enqueue time.
 */
export const QUEUES = {
  /** One job per delivery attempt chain; see `deliveries` table. */
  delivery: 'delivery',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface DeliveryJobPayload {
  deliveryId: string;
}
