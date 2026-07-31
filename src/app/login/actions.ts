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
      const code =
        error.type === "CredentialsSignin" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code === "too_many_attempts") {
        return "Too many attempts. Try again in a few minutes.";
      }
      if (code === "temporarily_unavailable") {
        // Generic by design: says nothing about the account, only that we
        // cannot safely authenticate right now.
        return "Sign-in is temporarily unavailable. Please try again shortly.";
      }
      return "Invalid email or password.";
    }
    throw error; // NEXT_REDIRECT on success
  }
}
