import type { ZapcutApi } from "../electron/preload";

declare global {
  interface Window {
    zapcut: ZapcutApi;
    // Local Font Access API (Chromium)
    queryLocalFonts(): Promise<{ family: string; fullName: string; style: string }[]>;
  }
}
