import { redirect } from "next/navigation";

export default function AdminManagePage() {
  redirect("/chat/admin/manage/conversations");
}
