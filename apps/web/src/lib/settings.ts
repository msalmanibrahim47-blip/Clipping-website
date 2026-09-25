import "server-only";
import { eq, getDb, userSettings } from "@longcut/db";
import { projectSettingsSchema, userDefaultsSchema, type ProjectSettings, type UserDefaults } from "@longcut/shared";

export async function userDefaults(userId: string): Promise<UserDefaults> {
  const row = await getDb().query.userSettings.findFirst({ where: eq(userSettings.userId, userId) });
  return userDefaultsSchema.parse(row?.defaults ?? {});
}

/** Merges user-provided settings over the user's saved defaults. */
export async function resolveProjectSettings(userId: string, input: Partial<ProjectSettings> | undefined): Promise<ProjectSettings> {
  const d = await userDefaults(userId);
  return projectSettingsSchema.parse({
    clipLength: d.clipLength,
    clipCount: d.clipCount,
    captionLanguage: d.captionLanguage,
    ...input,
  });
}
