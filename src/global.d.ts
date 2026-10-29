import type { ZapcutApi } from "../electron/preload";

declare global {
  interface Window {
    zapcut: ZapcutApi;
  }
}
