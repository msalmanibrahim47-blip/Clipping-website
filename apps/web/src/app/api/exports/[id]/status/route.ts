import { ownedExport, route } from "@/lib/api";
import { exportDto } from "@/lib/serialize";

export const GET = route<{ id: string }>(async (_req, { params, session }) => {
  return { export: exportDto(await ownedExport(session.userId, params.id)) };
});
