// @ts-check
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        AstroPWA({
            manifest: {
                name: "Tallinna peitus",
                short_name: "Tallinna peitus",
                description:
                    "Jet Lag: The Game Hide + Seek mängu kaart Tallinnas: peidualad, kombitsad, matching ja measuring küsimused, kõik Tallinna andmed rakenduses sees.",
                icons: [
                    {
                        src: "/JLIcon.png",
                        sizes: "1080x1080",
                        type: "image/png",
                    },
                    {
                        src: "/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
            },
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    site: process.env.URL ?? "http://localhost:4321",
    base: "/",
});
