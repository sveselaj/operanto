"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";

export type LoginState = {
  error?: string;
  /** The password was right; the form should now ask for a code. */
  needsToken?: boolean;
};

export async function loginAction(
  _prev: LoginState | null,
  formData: FormData,
): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      token: String(formData.get("token") ?? ""),
      redirectTo: "/dashboard",
    });
    return {};
  } catch (error) {
    if (error instanceof AuthError) {
      const code =
        error.type === "CredentialsSignin" && "code" in error
          ? (error as { code?: string }).code
          : undefined;
      if (code === "too_many_attempts") {
        return { error: "Too many attempts. Try again in a few minutes." };
      }
      if (code === "temporarily_unavailable") {
        // Generic by design: says nothing about the account, only that we
        // cannot safely authenticate right now.
        return { error: "Sign-in is temporarily unavailable. Please try again shortly." };
      }
      if (code === "totp_required") {
        return { needsToken: true };
      }
      if (code === "totp_invalid") {
        return { needsToken: true, error: "That code is not valid. Try the current one." };
      }
      return { error: "Invalid email or password." };
    }
    throw error; // NEXT_REDIRECT on success
  }
}
