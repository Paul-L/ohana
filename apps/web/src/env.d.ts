/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    visualEditing: boolean;
    settings: import("./lib/directus").Settings | null;
  }
}
