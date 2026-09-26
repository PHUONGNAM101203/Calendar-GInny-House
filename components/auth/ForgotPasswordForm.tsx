"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { MailIcon, Loader2Icon, ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import { requestPasswordResetAction } from "@/actions/auth";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validations/auth";
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

export default function ForgotPasswordForm() {
  const [serverError, setServerError] = useState("");
  // Địa chỉ vừa gửi, không phải một cờ boolean: màn xác nhận phải đọc lại
  // đúng email người ta gõ, vì nhầm địa chỉ là lý do phổ biến nhất khiến thư
  // "không tới".
  const [sentTo, setSentTo] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values: ForgotPasswordInput) {
    setServerError("");
    const result = await requestPasswordResetAction(values);
    if (!result.ok) {
      setServerError(result.error);
      return;
    }
    setSentTo(values.email);
  }

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-card/90 shadow-2xl shadow-black/20 ring-white/15 backdrop-blur-xl">
      <span className="absolute inset-x-0 top-0 h-1 bg-primary" />
      <CardHeader>
        <CardTitle className="text-2xl">Quên mật khẩu</CardTitle>
        <CardDescription>
          {sentTo
            ? "Kiểm tra hộp thư của bạn."
            : "Nhập email bạn dùng để đăng nhập, hệ thống sẽ gửi liên kết đặt lại mật khẩu."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sentTo ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
              <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" />
              <p className="text-sm">
                Nếu <b>{sentTo}</b> có tài khoản trong hệ thống, liên kết đặt lại mật khẩu đã được
                gửi tới đó. Liên kết chỉ dùng được một lần và sẽ hết hạn sau một giờ.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Không thấy thư? Xem cả mục Spam / Quảng cáo. Nếu vẫn không có, báo Kỹ thuật để được
              đặt lại thủ công.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Quay lại đăng nhập</Link>
            </Button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="ban@ginnyhouse.edu.vn"
                    className="pl-9"
                    {...register("email")}
                  />
                </div>
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>

              {serverError && <p className="text-sm text-destructive">{serverError}</p>}

              <Button type="submit" className="w-full gap-2" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2Icon className="size-4 animate-spin" />
                    Đang gửi...
                  </>
                ) : (
                  <>
                    Gửi liên kết đặt lại
                    <ArrowRightIcon className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Nhớ ra rồi?{" "}
              <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
                Đăng nhập
              </Link>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
