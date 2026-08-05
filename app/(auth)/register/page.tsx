import { getBranches } from "@/lib/branches";
import RegisterForm from "@/components/auth/RegisterForm";

export default async function RegisterPage() {
  const branches = await getBranches();
  return <RegisterForm branches={branches} />;
}
