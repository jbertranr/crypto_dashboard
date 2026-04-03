/**
 * config.js — Configuració d'entorn de l'app mòbil.
 * - localhost: crida directament al backend (port 3000)
 * - extern:    rutes relatives (el proxy de server-public.mjs s'encarrega)
 */

window.API_BASE =
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "";
