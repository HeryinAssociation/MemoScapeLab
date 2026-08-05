import { AdminShell } from "../admin-shell";
import { ImageGenSettingsApp } from "./imagegen-settings-app";

export default function ImageGenSettingsPage() {
  return (
    <AdminShell active="imagegen">
      <ImageGenSettingsApp />
    </AdminShell>
  );
}
