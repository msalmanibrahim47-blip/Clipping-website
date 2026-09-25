import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, getDb, users } from "@longcut/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  name: z.string().max(100).optional(),
});

export const POST = route(
  async (req) => {
    if (process.env.ALLOW_SIGNUPS === "false") throw new HttpError(403, "Sign-ups are disabled on this server.");
    const body = await parseBody(req, schema);
    const email = body.email.toLowerCase().trim();
    const db = getDb();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (existing) throw new HttpError(409, "An account with this email already exists.");
    const passwordHash = await bcrypt.hash(body.password, 12);
    const [user] = await db.insert(users).values({ email, passwordHash, name: body.name ?? null }).returning();
    await setSessionCookie({ userId: user.id, email: user.email });
    return { user: { id: user.id, email: user.email, name: user.name } };
  },
  { auth: false },
);
