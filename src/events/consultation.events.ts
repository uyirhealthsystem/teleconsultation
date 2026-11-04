import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";
import { ensureKafkaProducerConnected, kafkaProducer } from "../config/kafka.js";
import { logger } from "../utils/logger.js";

export interface ConsultationRoomReadyData {
  appointmentId: string;
  patientId: string;
  bookedByUserId: string;
  doctorId: string;
  hospitalId: string | null;
  scheduledAt: string;
  durationMinutes: number;
  mode: string;
}

interface ConsultationRoomReadyEvent {
  eventId: string;
  eventType: "ConsultationRoomReady";
  eventVersion: 1;
  occurredAt: string;
  data: ConsultationRoomReadyData;
}

export async function publishConsultationRoomReady(
  data: ConsultationRoomReadyData,
): Promise<void> {
  const event: ConsultationRoomReadyEvent = {
    eventId: randomUUID(),
    eventType: "ConsultationRoomReady",
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    data,
  };

  try {
    await ensureKafkaProducerConnected();

    await kafkaProducer.send({
      topic: env.kafka.topic,
      messages: [
        {
          key: data.appointmentId,
          value: JSON.stringify(event),
        },
      ],
    });

    logger.info(
      { appointmentId: data.appointmentId, eventId: event.eventId },
      "ConsultationRoomReady event published",
    );
  } catch (error) {
    // Notification publishing is best-effort.
    // It must not undo appointment confirmation or room provisioning.
    logger.error(
      { err: error, appointmentId: data.appointmentId },
      "Failed to publish ConsultationRoomReady event",
    );
  }
}