# Search and AI discovery setup

These steps need the site owner's accounts.

## Google Search Console

1. Go to <https://search.google.com/search-console> and add a **Domain** property for `lathe.ashwinsathian.com`.
2. Verify with the DNS TXT record it gives you. If the parent domain is already verified, the subdomain is covered.
3. Open **Sitemaps** and submit `https://lathe.ashwinsathian.com/sitemap-index.xml`.
4. Use **URL inspection** on `/`, `/docs`, `/redact-pdf` and `/heic-to-jpg`, and select **Request indexing**.
5. After a week, open **Pages** and read the reasons for any page not indexed.

## Bing Webmaster Tools

Bing's index feeds Copilot and several AI assistants.

1. Go to <https://www.bing.com/webmasters> and choose **Import from Google Search Console**.
2. Confirm that the sitemap was imported, or submit the same URL.
3. Use **URL Submission** for the four pages above.

## Check the structured data

Run these pages through <https://validator.schema.org/>: `/`, `/redact-pdf`, `/docs/guides/redact-a-pdf`.

## Check what AI assistants say

Monthly, ask ChatGPT, Perplexity, Claude and Google these questions, three times each, and note whether Lathe is mentioned and whether the details are right:

- How do I redact a PDF without uploading it?
- Is there a HEIC to JPG converter that does not upload my photos?
- What is a private alternative to online PDF tools?
- Does Lathe upload my files?

If an answer is wrong, fix the page that should state that fact.

## Places worth listing Lathe

Submit it yourself, with the same one-line description: "Free, open-source image and PDF tools that run entirely in your browser." Good fits are AlternativeTo, Awesome Self-Hosted, Product Hunt and Hacker News (Show HN). Do not post fake reviews or ask for them.
