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
  /**
   * `manual` = a user asked to replay this delivery: exactly one attempt,
   * recorded as manual, with no automatic retries if it fails. This is the
   * job's intent, not a copy of row data, so it can't go stale.
   */
  trigger?: 'manual';
}
