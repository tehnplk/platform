import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: string;
      fullname: string | null;
      department: string | null;
    };
  }

  interface User {
    role: string;
    fullname?: string | null;
    department?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    fullname?: string | null;
    department?: string | null;
  }
}
