import { AdminShell } from "../admin-shell";
import { UserSettingsApp } from "./user-settings-app";

export default function UserSettingsPage() {
  return <AdminShell active="user"><UserSettingsApp /></AdminShell>;
}
