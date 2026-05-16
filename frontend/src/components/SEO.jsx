import React from "react";
import { Helmet } from "react-helmet-async";

/**
 * SEO — per-page <head> manager.
 *
 * Defaults reflect the brand promise so any page that mounts <SEO /> without
 * props still gets a meaningful title/description. The LocalBusiness JSON-LD
 * is emitted by default — disable per page with `includeBusinessSchema={false}`.
 */
const DEFAULT_TITLE = "eFoodCare · ghar se accha khana · 90-min fresh tiffin & meal delivery";
const DEFAULT_DESCRIPTION =
  "India's first zero adulteration meal app · order ghar se accha khana · 90 minutes fresh Meal delivery · subscription base meal plan · unique e-meal pass base dining · No ajinomoto · 0% Maida · No Refined or Palm oil · Smartest Tiffin delivery services.";
const DEFAULT_IMAGE = "https://customer-assets.emergentagent.com/job_dining-pass-scan/artifacts/li3dreby_images.jpeg";
const SITE_URL = "https://efoodcare.in";

const BUSINESS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "eFoodCare",
  "image": DEFAULT_IMAGE,
  "@id": SITE_URL,
  "url": SITE_URL,
  "telephone": "+91-9175560211",
  "priceRange": "₹₹",
  "servesCuisine": ["Indian", "Maharashtrian", "Home-style Tiffin"],
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "shilangan Road, behind bhaktidham mandir, sai nagar",
    "addressLocality": "Amravati",
    "addressRegion": "Maharashtra",
    "postalCode": "444607",
    "addressCountry": "IN",
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 20.9374,
    "longitude": 77.7796,
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      "opens": "09:00",
      "closes": "22:00",
    },
  ],
};

export default function SEO({
  title,
  description,
  path,
  image,
  includeBusinessSchema = true,
  type = "website",
}) {
  const fullTitle = title ? `${title} · eFoodCare` : DEFAULT_TITLE;
  const desc = description || DEFAULT_DESCRIPTION;
  const url = SITE_URL + (path || "/");
  const img = image || DEFAULT_IMAGE;
  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />
      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={img} />
      <meta property="og:site_name" content="eFoodCare" />
      <meta property="og:locale" content="en_IN" />
      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={img} />
      {includeBusinessSchema && (
        <script type="application/ld+json">
          {JSON.stringify(BUSINESS_SCHEMA)}
        </script>
      )}
    </Helmet>
  );
}
