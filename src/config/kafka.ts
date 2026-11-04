import { Kafka, logLevel } from "kafkajs";

import { env } from "./env.js";
import { logger } from "../utils/logger.js";

const kafka = new Kafka({
  clientId: env.kafka.clientId,
  brokers: env.kafka.brokers,
  logLevel: logLevel.NOTHING,
});

export const kafkaProducer = kafka.producer();

let connected = false;
let connecting: Promise<void> | null = null;

export async function ensureKafkaProducerConnected(): Promise<void> {
  if (connected) return;

  if (!connecting) {
    connecting = kafkaProducer
      .connect()
      .then(() => {
        connected = true;
        logger.info("Kafka producer connected");
      })
      .catch((error: unknown) => {
        connected = false;
        logger.error({ err: error }, "Kafka producer connection failed");
        throw error;
      })
      .finally(() => {
        connecting = null;
      });
  }

  await connecting;
}

export async function disconnectKafkaProducer(): Promise<void> {
  if (!connected) return;

  await kafkaProducer.disconnect();
  connected = false;

  logger.info("Kafka producer disconnected");
}