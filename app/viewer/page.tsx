import { ViewerApp } from "../viewer-app";

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <ViewerApp projectId={id} />;
}
