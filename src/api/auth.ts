import { basicAuth } from "hono/basic-auth";
import type { MiddlewareHandler } from "hono";

export function createAuthMiddleware(auth: {
  username: string;
  password: string;
}): MiddlewareHandler {
  return basicAuth({
    username: auth.username,
    password: auth.password,
  });
}
