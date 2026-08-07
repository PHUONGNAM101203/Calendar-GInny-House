"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import {
  UserIcon,
  MailIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  Loader2Icon,
  ArrowRightIcon,
} from "lucide-react";
import { signUpAction } from "@/actions/auth";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { SELF_SIGNUP_ROLES, ROLE_LABELS } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectBranches } from "@/components/ui/multi-select-branches";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Branch } from "@/types";

export default function RegisterForm({ branches }: { branches: Branch[] }) {
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(values: RegisterInput) {
    setServerError("");
    const result = await signUpAction(values);
    if (result && !result.ok) setServerError(result.error);
  }

  return (
    <Card className="relative overflow-hidden rounded-2xl bg-card/90 shadow-2xl shadow-black/20 ring-white/15 backdrop-blur-xl">
      <span className="absolute inset-x-0 top-0 h-1 bg-gold" />
      <CardHeader>
        <CardTitle className="text-2xl">Gia nhập Ginny House</CardTitle>
        <CardDescription>Vài thông tin là có lịch làm việc của riêng bạn.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="full_name">Họ và tên</Label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="full_name"
                autoComplete="name"
                placeholder="Nguyễn Văn A"
                className="h-11 rounded-lg pl-9"
                {...register("full_name")}
              />
            </div>
            {errors.full_name && (
              <p className="text-sm text-destructive">{errors.full_name.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <MailIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="ban@gmail.com"
                className="h-11 rounded-lg pl-9"
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role">Bạn là</Label>
            <Controller
              control={control}
              name="role"
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger id="role" className="h-11! w-full rounded-lg">
                    <SelectValue placeholder="Chọn vai trò của bạn" />
                  </SelectTrigger>
                  <SelectContent>
                    {SELF_SIGNUP_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="branch_ids">Cơ sở</Label>
            <Controller
              control={control}
              name="branch_ids"
              defaultValue={[]}
              render={({ field }) => (
                <MultiSelectBranches
                  branches={branches}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Chọn cơ sở làm việc"
                />
              )}
            />
            {errors.branch_ids && (
              <p className="text-sm text-destructive">{errors.branch_ids.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mật khẩu</Label>
            <div className="relative">
              <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                className="h-11 rounded-lg pr-10 pl-9"
                {...register("password")}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm_password">Xác nhận mật khẩu</Label>
            <div className="relative">
              <LockIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="confirm_password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="••••••••"
                className="h-11 rounded-lg pl-9"
                {...register("confirm_password")}
              />
            </div>
            {errors.confirm_password && (
              <p className="text-sm text-destructive">{errors.confirm_password.message}</p>
            )}
          </div>

          {serverError && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}

          <Button type="submit" disabled={isSubmitting} className="h-11 w-full gap-2 rounded-lg">
            {isSubmitting ? (
              <>
                <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />
                Đang tạo tài khoản...
              </>
            ) : (
              <>
                Tạo tài khoản
                <ArrowRightIcon className="size-4" />
              </>
            )}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Đăng nhập
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
