import type { MetadataRoute } from "next";

/** Marketing pages are indexable; cockpit and API surfaces are not. */
export default function robots(): MetadataRoute.Robots {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://operanto.ai";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/customers",
          "/opportunities",
          "/tasks",
          "/activity",
          "/integrations",
          "/settings",
          "/audit",
          "/login",
          "/invite/",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
  };
}
