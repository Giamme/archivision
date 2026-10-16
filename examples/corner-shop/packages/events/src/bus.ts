import { connect, JSONCodec, type NatsConnection, type Subscription } from 'nats';
import type { Payloads, Subject } from './subjects';

const codec = JSONCodec();
let connection: Promise<NatsConnection> | null = null;

/** The process's connection to the bus, opened on first use. A failed connect is retried on the next call. */
export function getConnection(): Promise<NatsConnection> {
  if (!connection) {
    connection = connect({
      servers: process.env.NATS_URL ?? 'nats://localhost:4222',
      name: process.env.SERVICE_NAME ?? 'corner-shop',
      maxReconnectAttempts: -1,
    }).catch(err => {
      connection = null;
      throw err;
    });
  }
  return connection;
}

/** Publishes one event. Fire and forget: subscribers that need every message use a durable SQS bridge. */
export async function publish<S extends Subject>(subject: S, payload: Payloads[S]): Promise<void> {
  const nc = await getConnection();
  nc.publish(subject, codec.encode(payload));
}

export type EventHandler<S extends Subject> = (payload: Payloads[S]) => Promise<void>;

/**
 * Subscribes in a queue group, so the worker processes of one group share the messages of a subject. A handler that
 * throws is logged and the message dropped; handlers must be safe to run twice.
 */
export async function subscribe<S extends Subject>(subject: S, group: string, handler: EventHandler<S>): Promise<Subscription> {
  const nc = await getConnection();
  const sub = nc.subscribe(subject, { queue: group });
  void (async () => {
    for await (const msg of sub) {
      try {
        await handler(codec.decode(msg.data) as Payloads[S]);
      } catch (err) {
        console.error(`[bus] ${group} failed on ${subject}`, err);
      }
    }
  })();
  return sub;
}

/** Lets in-flight messages finish, then closes the connection. Called on SIGTERM. */
export async function drain(): Promise<void> {
  if (!connection) return;
  const nc = await connection;
  connection = null;
  await nc.drain();
}
