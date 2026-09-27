import { z } from "zod";

// A role the candidate can pick on the role-picker screen (GET /roles).
export const Role = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
});
export type Role = z.infer<typeof Role>;

export const RoleList = z.array(Role);
export type RoleList = z.infer<typeof RoleList>;

// Response for requesting an ephemeral voice session token (POST /sessions/:id/voice-token).
export const VoiceTokenResponse = z.object({
  token: z.string().min(1),
});
export type VoiceTokenResponse = z.infer<typeof VoiceTokenResponse>;

