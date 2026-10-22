import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  port: Number(process.env.PORT ?? 8082),

  logLevel: process.env.LOG_LEVEL ?? "info",

  kafka: {
    brokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    clientId: process.env.KAFKA_CLIENT_ID ?? "ecgonwheels-service",
    groupId: process.env.KAFKA_GROUP_ID ?? "ecgonwheels-service-group",
  },
  // redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
};