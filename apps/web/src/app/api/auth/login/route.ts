import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, getDb, users } from "@longcut/db";
import { HttpError, parseBody, route } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
// Constant-time-ish failure path: always run a bcrypt compare, even for unknown emails.
let dummyHash: string | null = null;

export const POST = route(
  async (req) => {
    const body = await parseBody(req, schema);
    const user = await getDb().query.users.findFirst({ where: eq(users.email, body.email.toLowerCase().trim()) });
    dummyHash ??= await bcrypt.hash("longcut-timing-equalizer", 12);
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? dummyHash);
    if (!user || !ok) throw new HttpError(401, "Incorrect email or password.");
    await setSessionCookie({ userId: user.id, email: user.email });
    return { user: { id: user.id, email: user.email, name: user.name } };
  },
  { auth: false },
);
