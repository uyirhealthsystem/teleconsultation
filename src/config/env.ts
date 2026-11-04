
import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  port: Number(process.env.PORT ?? 3000),

  logLevel: process.env.LOG_LEVEL ?? "info",

 kafka: {
  brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092")
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean),

  clientId:
    process.env.KAFKA_CLIENT_ID ?? "teleconsultation-service",

  groupId:
    process.env.KAFKA_GROUP_ID ?? "teleconsultation-service-group",

  topic:
    process.env.KAFKA_TOPIC ?? "teleconsultation.events",
},
};
