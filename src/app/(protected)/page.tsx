import { redirect } from "next/navigation";

/** `/` lands on 账目. */
export default function HomePage() {
  redirect("/records");
}
