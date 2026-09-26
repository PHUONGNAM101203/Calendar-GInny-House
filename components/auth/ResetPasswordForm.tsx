"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { LockIcon, EyeIcon, EyeOffIcon, Loader2Icon, CheckCircle2Icon } from "lucide-react";
import { updatePasswordAction } from "@/actions/auth";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/validations/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  async function onSubmit(values: ResetPasswordInput) {
    setServerError("");
    const result = await updatePasswordAction(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setDone(true);
    // Đổi mật khẩu xong là đã có phiên đăng nhập hợp lệ, không bắt đăng nhập
    // lại. refresh() để tầng server đọc lại phiên trước khi rời trang.
    router.refresh();
  }

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-card/90 shadow-2xl shadow-black/20 ring-white/15 backdrop-blur-xl">
      <span className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <CardHeader>
        <CardTitle className="text-2xl">Đặt mật khẩu mới</CardTitle>
        <CardDescription>
          {done ? "Xong rồi." : "Chọn một mật khẩu mới cho tài khoản của bạn."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
              <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" />
              <p className="text-sm">Mật khẩu đã được đổi. Bạn đang đăng nhập bằng mật khẩu mới.</p>
            </div>
            <Button asChild className="w-full">
              <Link href="/calendar">Vào lịch làm việc</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Mật khẩu mới</Label>
              <div className="relative">
                <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pl-9 pr-9"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm_password">Nhập lại mật khẩu mới</Label>
              <div className="relative">
                <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="confirm_password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pl-9"
                  {...register("confirm_password")}
                />
              </div>
              {errors.confirm_password && (
                <p className="text-sm text-destructive">{errors.confirm_password.message}</p>
              )}
            </div>

            {serverError && <p className="text-sm text-destructive">{serverError}</p>}

            <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Đang lưu...
                </>
              ) : (
                "Đổi mật khẩu"
              )}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
