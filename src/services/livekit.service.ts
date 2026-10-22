// import { AccessToken } from "livekit-server-sdk";
// import { prisma } from "./prisma.service";
// import { env } from "../config/env";
// import type { UserRole } from "../middlewares/requireUser.middleware";

// class ApiError extends Error {
//   constructor(
//     public statusCode: number,
//     message: string,
//   ) {
//     super(message);
//     this.name = "ApiError";
//   }
// }

// interface JoinConsultationInput {
//   appointmentId: string;
//   userId: string;
//   role: UserRole;
// }

// export async function joinConsultation({
//   appointmentId,
//   userId,
//   role,
// }: JoinConsultationInput) {
//   // 1. Find the appointment.
//   const appointment = await prisma.appointment.findUnique({
//     where: { appointmentId },
//   });

//   if (!appointment) {
//     throw new ApiError(404, "Appointment not found");
//   }

//   // 2. Verify that the caller belongs to this appointment.
//   const isPatient =
//     role === "CITIZEN" && appointment.patientId === userId;

//   const isDoctor =
//     role === "DOCTOR" && appointment.doctorId === userId;

//   if (!isPatient && !isDoctor) {
//     throw new ApiError(
//       403,
//       "You are not authorized to join this consultation",
//     );
//   }

//   // 3. Check appointment status.
//   if (
//     appointment.status !== "CONFIRMED" &&
//     appointment.status !== "IN_PROGRESS"
//   ) {
//     throw new ApiError(
//       409,
//       "This appointment is not available for consultation",
//     );
//   }

//   // 4. Enforce a consultation time window.
//   const now = Date.now();
//   const scheduledAt = new Date(appointment.scheduledAt).getTime();
//   const durationMs = appointment.durationMinutes * 60_000;

//   const allowedStart = scheduledAt - 15 * 60_000;
//   const allowedEnd = scheduledAt + durationMs + 60 * 60_000;

//   if (now < allowedStart || now > allowedEnd) {
//     throw new ApiError(
//       409,
//       "Consultation is outside the permitted time window",
//     );
//   }

//   // 5. Use a stable, appointment-specific room name.
//   const roomName = `consultation_${appointment.appointmentId}`;

//   // 6. Create the session only once per appointment.
//   // READY must match the status enum in your Prisma schema.
//   await prisma.consultationSession.upsert({
//     where: { appointmentId },
//     create: {
//       appointmentId,
//       livekitRoomName: roomName,
//       status: "READY",
//     },
//     update: {},
//   });

//   // 7. Use a stable participant identity.
//   const participantIdentity = `${role.toLowerCase()}:${userId}`;

//   // 8. Generate a short-lived token.
//   const accessToken = new AccessToken(
//     env.livekitApiKey,
//     env.livekitApiSecret,
//     {
//       identity: participantIdentity,
//       ttl: "10m",
//     },
//   );

//   accessToken.addGrant({
//     roomJoin: true,
//     room: roomName,
//     canPublish: true,
//     canSubscribe: true,
//   });

//   const token = await accessToken.toJwt();

//   return {
//     appointmentId,
//     roomName,
//     livekitUrl: env.livekitUrl,
//     token,
//     participantIdentity,
//     mode: appointment.mode,
//     scheduledAt: appointment.scheduledAt,
//     durationMinutes: appointment.durationMinutes,
//   };
// }