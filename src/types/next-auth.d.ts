import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
      department: string | null;
    };
  }

  interface User {
    role: string;
    department?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    department?: string | null;
  }
}
