import { eq, getDb, users } from "@longcut/db";
import { HttpError, route } from "@/lib/api";

export const GET = route(async (_req, { session }) => {
  const user = await getDb().query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) throw new HttpError(401, "Please sign in");
  return { user: { id: user.id, email: user.email, name: user.name } };
});
