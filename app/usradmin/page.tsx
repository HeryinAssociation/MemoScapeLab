import { AdminShell } from "../admin-shell";
import { UserAdminApp } from "./user-admin-app";

export default function UserAdminPage() {
  return <AdminShell active="users"><UserAdminApp /></AdminShell>;
}
