import { requireProfile } from "@/lib/auth";
import { Separator } from "@/components/ui/separator";
import AccountForm from "@/components/account/AccountForm";

export default async function AccountPage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Thông tin cá nhân</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cập nhật họ tên và số điện thoại của bạn.</p>
      </div>
      <Separator />
      <AccountForm profile={profile} />
    </div>
  );
}
