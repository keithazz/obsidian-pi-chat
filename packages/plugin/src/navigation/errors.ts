import type { NavErrorKind } from "@educator-agency/shared";

export { NavErrorKind } from "@educator-agency/shared";

export class NavError extends Error {
  constructor(public kind: NavErrorKind, message: string) {
    super(message);
    this.name = "NavError";
  }
}
