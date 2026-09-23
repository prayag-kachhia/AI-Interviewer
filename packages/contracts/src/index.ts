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
