"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export async function loginAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/dashboard",
    });
    return null;
  } catch (error) {
    if (error instanceof AuthError) {
      return error.type === "CredentialsSignin" &&
        "code" in error &&
        (error as { code?: string }).code === "too_many_attempts"
        ? "Too many attempts. Try again in a few minutes."
        : "Invalid email or password.";
    }
    throw error; // NEXT_REDIRECT on success
  }
}
