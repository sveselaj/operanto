import type { MetadataRoute } from "next";

const MARKETING_PATHS = [
  "",
  "/product",
  "/how-it-works",
  "/real-estate",
  "/security",
  "/about",
  "/contact",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://operanto.ai";
  return MARKETING_PATHS.map((path) => ({
    url: `${site}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
