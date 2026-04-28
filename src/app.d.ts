declare global {
  namespace App {
    interface Locals {
      user: { authenticated: boolean };
      csrfToken: string;
    }
  }
}

export {};
