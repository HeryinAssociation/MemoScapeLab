import { AdminShell } from "../admin-shell";
import { WorkbenchApp } from "./workbench-app";

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return (
    <AdminShell active="work">
      <WorkbenchApp projectId={id} />
    </AdminShell>
  );
}
